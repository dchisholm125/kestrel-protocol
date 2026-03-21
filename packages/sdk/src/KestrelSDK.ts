import { Jupiter, SwapMode } from '@jup-ag/core';
import JSBI from 'jsbi';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  type Cluster,
  type VersionedTransactionResponse,
} from '@solana/web3.js';
import {
  computePremiumLamports,
  createProtectionQuote,
  prepareProtection,
  previewSettlement,
} from './math.js';
import { DEFAULT_KESTREL_PROGRAM_ID, KestrelProgramClient } from './onchain.js';
import type {
  KestrelMarketState,
  KestrelPrepareProtectionInput,
  KestrelPrepareProtectionResult,
  KestrelSDKOptions,
  ProtectedSwapQuote,
  ProtectedSwapQuoteParams,
  ProtectedSwapResult,
  ProtectionQuote,
  ProtectionQuoteRequest,
  SettlementPreview,
  SettlementPreviewInput,
} from './types.js';

const DEFAULT_SOL_PRICE_USD = 150;
const DEFAULT_QUOTE_TTL_MS = 60_000;
const DEFAULT_ROUTE_BUFFER_BPS = 25;
const WRAPPED_SOL_MINT = 'So11111111111111111111111111111111111111112';
const STABLE_MINT_TO_USD: Record<string, number> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 1,
  Es9vMFrzaCERmJfrF4H2FYD4vR6CKxR271GGBqBPdZiN: 1,
};

export const DEFAULT_MARKET_STATE: KestrelMarketState = {
  regime: 'CALM',
  currentBreachRate: 0.029,
  premiumBps: 20,
  explanation: 'Default public market state until a live regime feed is configured',
  vaultOpen: true,
  coveredBps: 75,
  liabilityCapBps: 100,
  capitalGamma: 0.06,
};

function toPublicKey(value: PublicKey | string | undefined): PublicKey {
  if (!value) {
    return new PublicKey(DEFAULT_KESTREL_PROGRAM_ID);
  }
  return value instanceof PublicKey ? value : new PublicKey(value);
}

function toSafeNumber(value: { toString(): string }, label: string): number {
  const parsed = Number(value.toString());
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${label} exceeds JavaScript safe integer range`);
  }
  return parsed;
}

function isSuccessfulSwapResult(
  result: { txid: string; inputAmount: number; outputAmount: number } | { error?: unknown },
): result is { txid: string; inputAmount: number; outputAmount: number } {
  return 'txid' in result;
}

const JSBI_NAMESPACE = JSBI as unknown as {
  BigInt(value: number | string | boolean | object): unknown;
};

export class KestrelSDK {
  private readonly network: Cluster;
  private readonly connection?: Connection;
  private readonly wallet?: Keypair;
  private readonly settler?: Keypair;
  private readonly marketProvider?: KestrelSDKOptions['marketProvider'];
  private readonly solPriceProvider?: KestrelSDKOptions['solPriceProvider'];
  private readonly programId: PublicKey;
  private readonly quoteTtlMs: number;
  private readonly routeSlippageBufferBps: number;
  private jupiterPromise?: Promise<Jupiter>;
  private programClient?: KestrelProgramClient;

  constructor(options: KestrelSDKOptions = {}) {
    this.network = options.network ?? 'mainnet-beta';
    this.connection = options.connection;
    this.wallet = options.wallet;
    this.settler = options.settler ?? options.wallet;
    this.marketProvider = options.marketProvider;
    this.solPriceProvider = options.solPriceProvider;
    this.programId = toPublicKey(options.programId);
    this.quoteTtlMs = options.quoteTtlMs ?? DEFAULT_QUOTE_TTL_MS;
    this.routeSlippageBufferBps = options.routeSlippageBufferBps ?? DEFAULT_ROUTE_BUFFER_BPS;
  }

  async getMarket(): Promise<KestrelMarketState> {
    if (!this.marketProvider) {
      return DEFAULT_MARKET_STATE;
    }
    return Promise.resolve(this.marketProvider());
  }

  quote(input: ProtectionQuoteRequest): ProtectionQuote {
    return createProtectionQuote(input);
  }

  prepare(input: KestrelPrepareProtectionInput): KestrelPrepareProtectionResult {
    return prepareProtection(input);
  }

  previewSettlement(input: SettlementPreviewInput): SettlementPreview {
    return previewSettlement(input);
  }

  async issuePolicy(input: ProtectionQuoteRequest): Promise<string> {
    const quote = this.quote(input);
    console.log(`[Kestrel] Issuing policy for ${input.amountUsd} USD...`);
    console.log(`[Kestrel] Premium: ${quote.premiumBps} bps (${quote.premiumLamports} lamports)`);
    return '2pD5y8...mock_sig';
  }

  async settleAndClaim(policyId: string, actualSlippageBps: number): Promise<string> {
    console.log(`[Kestrel] Settling policy ${policyId} with observed slippage: ${actualSlippageBps} bps`);
    return '5fG9v2...mock_settle_sig';
  }

  async quoteProtectedSwap(params: ProtectedSwapQuoteParams): Promise<ProtectedSwapQuote> {
    const market = await this.getMarket();

    if (!market.vaultOpen || market.regime === 'HALTED') {
      throw new Error('Kestrel vault is not currently accepting new protection policies');
    }

    const guaranteedBps = params.guaranteedSlippageBps ?? market.coveredBps;
    if (guaranteedBps <= 0 || guaranteedBps > 500) {
      throw new Error('guaranteedSlippageBps must be between 1 and 500');
    }

    const inputMint = new PublicKey(params.inputMint);
    const outputMint = new PublicKey(params.outputMint);
    const jupiter = await this.getJupiter();
    const { routesInfos } = await jupiter.computeRoutes({
      inputMint,
      outputMint,
      amount: JSBI_NAMESPACE.BigInt(params.amountLamports) as never,
      slippageBps: guaranteedBps + this.routeSlippageBufferBps,
      onlyDirectRoutes: false,
      swapMode: SwapMode.ExactIn,
      asLegacyTransaction: false,
      filterTopNResult: 3,
    });

    const bestRoute = routesInfos[0];
    if (!bestRoute) {
      throw new Error(`No Jupiter route available for ${params.inputMint} -> ${params.outputMint}`);
    }

    const outputDecimals = await this.getMintDecimals(outputMint);
    const expectedOutputAmount = toSafeNumber(bestRoute.outAmount, 'expected output amount');
    const solPriceUsd = await this.getSolPriceUsd();
    const swapSizeUsd = this.estimateSwapSizeUsd({
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      amountLamports: params.amountLamports,
      expectedOutputAmount,
      expectedOutputDecimals: outputDecimals,
      solPriceUsd,
    });

    return {
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      amountLamports: params.amountLamports,
      expectedOutputAmount,
      expectedOutputDecimals: outputDecimals,
      guaranteedBps,
      premiumLamports: computePremiumLamports(swapSizeUsd, market.premiumBps, solPriceUsd, 1),
      premiumBps: market.premiumBps,
      regime: market.regime,
      validUntil: new Date(Date.now() + this.quoteTtlMs),
      _jupiterRoute: bestRoute,
      _market: market,
      _pricing: {
        solPriceUsd,
        swapSizeUsd,
        outputTokenUsdPrice: this.getStableTokenUsdPrice(params.outputMint) ?? null,
      },
    };
  }

  async executeProtectedSwap(quote: ProtectedSwapQuote): Promise<ProtectedSwapResult> {
    const { wallet, settler } = this.requireExecutionContext();
    const programClient = this.getProgramClient();

    if (quote.validUntil.getTime() <= Date.now()) {
      throw new Error('Protected swap quote expired. Request a fresh quote before executing.');
    }

    const policyIssue = await programClient.issuePolicy({
      guaranteedSlippageBps: quote.guaranteedBps,
      swapSizeUsdCents: Math.max(1, Math.round(quote._pricing.swapSizeUsd * 100)),
      direction: 0,
      premiumLamports: quote.premiumLamports,
      sequenceNumber: Date.now(),
      solPriceUsd: quote._pricing.solPriceUsd,
      market: quote._market,
      buyer: wallet.publicKey,
      buyerKeypair: wallet,
    });

    let swapSignature = '';
    try {
      const jupiter = await this.getJupiter();
      const { execute } = await jupiter.exchange({
        routeInfo: quote._jupiterRoute,
        userPublicKey: wallet.publicKey,
        wrapUnwrapSOL: true,
        asLegacyTransaction: false,
      });
      const swapResult = await execute();
      if (!isSuccessfulSwapResult(swapResult)) {
        throw new Error(String(swapResult.error ?? 'unknown Jupiter error'));
      }
      swapSignature = swapResult.txid;

      const transaction = await this.getTransactionWithRetry(swapSignature);
      const parsedOutputAmount = this.sumTokenBalanceDelta(
        transaction,
        wallet.publicKey.toBase58(),
        quote.outputMint,
      );
      const actualOutputAmount = parsedOutputAmount > 0n
        ? Number(parsedOutputAmount)
        : swapResult.outputAmount;

      const actualSlippageBps = this.computeActualSlippageBps(quote, actualOutputAmount);
      const settlement = previewSettlement({
        actualSlippageBps,
        guaranteedSlippageBps: quote.guaranteedBps,
        swapSizeUsd: quote._pricing.swapSizeUsd,
        solPriceUsd: quote._pricing.solPriceUsd,
      });

      try {
        await programClient.settlePolicy({
          policyAddress: policyIssue.policyAddress,
          actualSlippageBps,
          buyerPublicKey: wallet.publicKey,
          buyerKeypair: wallet,
          payoutLamports: settlement.payoutLamports,
        }, settler);
      } catch (error: unknown) {
        throw new Error(
          `Swap ${swapSignature} executed, but settlement for policy ${policyIssue.policyAddress.toBase58()} failed: ${this.formatError(error)}`,
        );
      }

      return {
        policyAddress: policyIssue.policyAddress.toBase58(),
        swapSignature,
        actualSlippageBps,
        guaranteedBps: quote.guaranteedBps,
        outcome: settlement.payoutLamports > 0 ? 'PAID_CLAIM' : 'KEPT_PREMIUM',
        premiumPaidLamports: quote.premiumLamports,
        payoutLamports: settlement.payoutLamports,
        vaultNetLamports: quote.premiumLamports - settlement.payoutLamports,
        solscanSwap: this.solscanUrl('tx', swapSignature),
        solscanPolicy: this.solscanUrl('account', policyIssue.policyAddress.toBase58()),
      };
    } catch (error: unknown) {
      const context = swapSignature
        ? `swap ${swapSignature}`
        : `policy ${policyIssue.policyAddress.toBase58()}`;
      throw new Error(
        `Protected swap failed after issuing ${context}. The current program does not auto-rollback issued policies: ${this.formatError(error)}`,
      );
    }
  }

  private computeActualSlippageBps(quote: ProtectedSwapQuote, actualOutputAmount: number): number {
    const fairOutputAmount = this.computeFairOutputAmount(quote);
    if (fairOutputAmount <= 0) {
      return 0;
    }

    return Math.max(0, Math.round(((fairOutputAmount - actualOutputAmount) / fairOutputAmount) * 10_000));
  }

  private computeFairOutputAmount(quote: ProtectedSwapQuote): number {
    if (this.isWrappedSol(quote.inputMint) && quote._pricing.outputTokenUsdPrice) {
      const fairOutputUiAmount =
        (quote.amountLamports / LAMPORTS_PER_SOL) *
        (quote._pricing.solPriceUsd / quote._pricing.outputTokenUsdPrice);

      return Math.round(fairOutputUiAmount * (10 ** quote.expectedOutputDecimals));
    }

    return quote.expectedOutputAmount;
  }

  private estimateSwapSizeUsd(params: {
    inputMint: string;
    outputMint: string;
    amountLamports: number;
    expectedOutputAmount: number;
    expectedOutputDecimals: number;
    solPriceUsd: number;
  }): number {
    if (this.isWrappedSol(params.inputMint)) {
      return (params.amountLamports / LAMPORTS_PER_SOL) * params.solPriceUsd;
    }

    const outputTokenUsdPrice = this.getStableTokenUsdPrice(params.outputMint);
    if (outputTokenUsdPrice) {
      return (params.expectedOutputAmount / (10 ** params.expectedOutputDecimals)) * outputTokenUsdPrice;
    }

    throw new Error(
      'Unable to derive USD notional for this pair. Use wrapped SOL input or a stablecoin output mint, or provide a custom quote pipeline.',
    );
  }

  private getStableTokenUsdPrice(mint: string): number | null {
    return STABLE_MINT_TO_USD[mint] ?? null;
  }

  private isWrappedSol(mint: string): boolean {
    return mint === WRAPPED_SOL_MINT;
  }

  private async getSolPriceUsd(): Promise<number> {
    if (this.solPriceProvider) {
      return Promise.resolve(this.solPriceProvider());
    }

    try {
      const response = await fetch(
        'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
      );
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = await response.json() as { solana?: { usd?: number } };
      if (typeof payload.solana?.usd === 'number' && Number.isFinite(payload.solana.usd) && payload.solana.usd > 0) {
        return payload.solana.usd;
      }
    } catch {
      return DEFAULT_SOL_PRICE_USD;
    }

    return DEFAULT_SOL_PRICE_USD;
  }

  private getProgramClient(): KestrelProgramClient {
    const { connection, wallet } = this.requireExecutionContext();
    if (!this.programClient) {
      this.programClient = new KestrelProgramClient(connection, wallet, this.programId);
    }
    return this.programClient;
  }

  private async getJupiter(): Promise<Jupiter> {
    const { connection, wallet } = this.requireExecutionContext();
    if (!this.jupiterPromise) {
      this.jupiterPromise = Jupiter.load({
        connection,
        cluster: this.network,
        user: wallet,
        wrapUnwrapSOL: true,
      });
    }
    return this.jupiterPromise;
  }

  private requireExecutionContext(): {
    connection: Connection;
    wallet: Keypair;
    settler: Keypair;
  } {
    if (!this.connection || !this.wallet) {
      throw new Error(
        'KestrelSDK needs `connection` and `wallet` to quote or execute protected swaps.',
      );
    }

    return {
      connection: this.connection,
      wallet: this.wallet,
      settler: this.settler ?? this.wallet,
    };
  }

  private async getTransactionWithRetry(signature: string): Promise<VersionedTransactionResponse> {
    const { connection } = this.requireExecutionContext();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const transaction = await connection.getTransaction(signature, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed',
      });
      if (transaction) {
        return transaction;
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }

    throw new Error(`Transaction ${signature} was not available after confirmation`);
  }

  private sumTokenBalanceDelta(
    transaction: VersionedTransactionResponse,
    owner: string,
    mint: string,
  ): bigint {
    const meta = transaction.meta;
    if (!meta) {
      return 0n;
    }

    const pre = (meta.preTokenBalances ?? []).filter(
      (balance) => balance.owner === owner && balance.mint === mint,
    );
    const post = (meta.postTokenBalances ?? []).filter(
      (balance) => balance.owner === owner && balance.mint === mint,
    );

    const preTotal = pre.reduce((sum, balance) => sum + this.toRawAmount(balance.uiTokenAmount?.amount), 0n);
    const postTotal = post.reduce((sum, balance) => sum + this.toRawAmount(balance.uiTokenAmount?.amount), 0n);
    return postTotal - preTotal;
  }

  private async getMintDecimals(mint: PublicKey): Promise<number> {
    const { connection } = this.requireExecutionContext();
    const response = await connection.getParsedAccountInfo(mint, 'confirmed');
    const account = response.value;
    if (!account) {
      throw new Error(`Mint account ${mint.toBase58()} not found`);
    }

    const parsedData = account.data;
    if (typeof parsedData === 'object' && 'parsed' in parsedData) {
      const info = parsedData.parsed as { info?: { decimals?: unknown } };
      if (typeof info.info?.decimals === 'number') {
        return info.info.decimals;
      }
    }

    throw new Error(`Unable to read decimals for mint ${mint.toBase58()}`);
  }

  private toRawAmount(amount: string | undefined): bigint {
    return amount ? BigInt(amount) : 0n;
  }

  private solscanUrl(kind: 'tx' | 'account', address: string): string {
    const clusterSuffix = this.network === 'mainnet-beta' ? '' : `?cluster=${this.network}`;
    return `https://solscan.io/${kind}/${address}${clusterSuffix}`;
  }

  private formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
