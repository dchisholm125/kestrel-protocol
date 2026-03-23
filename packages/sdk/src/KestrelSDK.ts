import * as anchor from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import type {
  MarketState,
  ProtectParams,
  Policy,
  SettleParams,
  Settlement,
} from './types.js';
import {
  DEFAULT_SOL_PRICE_USD,
  GUARANTEE_TIERS,
  MAINNET_PROGRAM_ID,
  SOL_MINT,
  USDC_MINT,
  TOKEN_PAIR_SOL_USDC,
} from './constants.js';

export interface KestrelSDKOptions {
  rpcUrl?: string;
  programId?: string;
  commitment?: anchor.web3.Commitment;
}

export class KestrelSDK {
  private readonly programId: PublicKey;
  private readonly rpcUrl: string;
  private readonly commitment: anchor.web3.Commitment;
  private readonly connection: Connection;

  constructor(options: KestrelSDKOptions = {}) {
    this.programId = new PublicKey(options.programId ?? MAINNET_PROGRAM_ID);
    this.rpcUrl = options.rpcUrl ?? 'https://api.mainnet-beta.solana.com';
    this.commitment = options.commitment ?? 'confirmed';
    this.connection = new Connection(this.rpcUrl, this.commitment);
  }

  async getMarket(): Promise<MarketState> {
    return {
      regime: 'CALM',
      premiumBps: 20,
      vaultOpen: true,
      guaranteeOptions: [...GUARANTEE_TIERS],
      breachRate: 0.029,
      coveredBps: 75,
    };
  }

  async protect(params: ProtectParams): Promise<Policy> {
    // Validate token pair before processing
    const inputMint = params.inputMint ?? SOL_MINT;
    const outputMint = params.outputMint ?? USDC_MINT;
    const direction = inputMint === SOL_MINT ? 0 : 1;

    const isSOLUSDC =
      (inputMint === SOL_MINT && outputMint === USDC_MINT) ||
      (inputMint === USDC_MINT && outputMint === SOL_MINT);

    if (!isSOLUSDC) {
      throw new Error(
        'Kestrel v1 supports SOL/USDC only. ' +
        'Other pairs require separate pricing ' +
        'calibration. Support coming in v2.'
      );
    }

    if (!Number.isFinite(params.swapSizeUsd) || params.swapSizeUsd <= 0) {
      throw new Error('swapSizeUsd must be a positive number');
    }
    if (!Number.isFinite(params.guaranteedBps) || params.guaranteedBps <= 0) {
      throw new Error('guaranteedBps must be a positive number');
    }
    if (params.direction !== undefined && params.direction !== direction) {
      throw new Error(`direction must be ${direction} for inputMint ${inputMint}`);
    }

    const tier = GUARANTEE_TIERS.find((item) => item.guaranteedBps === params.guaranteedBps);
    if (!tier) {
      throw new Error(
        `guaranteedBps ${params.guaranteedBps} is unsupported. Allowed: ${GUARANTEE_TIERS.map((item) => item.guaranteedBps).join(', ')}`,
      );
    }

    const premiumUsd = (params.swapSizeUsd * tier.premiumBps) / 10_000;
    const premiumLamports = Math.max(
      1,
      Math.ceil((premiumUsd / DEFAULT_SOL_PRICE_USD) * anchor.web3.LAMPORTS_PER_SOL),
    );

    const market = await this.getMarket();
    const result = {
      policyAddress: Keypair.generate().publicKey,
      regime: market.regime,
      premiumBps: market.premiumBps,
      sequenceNumber: 0,
      tokenPair: TOKEN_PAIR_SOL_USDC,
      direction,
    };

    return {
      address: result.policyAddress.toString(),
      premiumLamports: premiumLamports,
      premiumBps: market.premiumBps,
      guaranteedBps: params.guaranteedBps,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      regime: result.regime,
      sequenceNumber: result.sequenceNumber,
    };
  }

  async settle(params: SettleParams): Promise<Settlement> {
    if (!params.policyAddress) {
      throw new Error('policyAddress is required');
    }
    if (!Number.isFinite(params.swapSizeUsd) || params.swapSizeUsd <= 0) {
      throw new Error('swapSizeUsd must be a positive number');
    }
    if (!Number.isFinite(params.sequenceNumber) || params.sequenceNumber < 0) {
      throw new Error('sequenceNumber must be a non-negative number');
    }

    let actualOutputUsdcMicro = params.actualOutputUsdcMicro;
    if (typeof actualOutputUsdcMicro !== 'number' && params.swapSignature) {
      const tx = await this.connection.getTransaction(params.swapSignature, {
        maxSupportedTransactionVersion: 0,
        commitment: this.commitment as anchor.web3.Finality,
      });
      if (!tx) {
        throw new Error('Swap transaction not found');
      }
      if (tx.meta?.err) {
        throw new Error('Swap transaction failed');
      }

      const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
      const preUsdc = (tx.meta?.preTokenBalances ?? [])
        .filter((balance) => balance.mint === USDC_MINT)
        .reduce((sum, balance) => sum + (balance.uiTokenAmount.uiAmount ?? 0), 0);
      const postUsdc = (tx.meta?.postTokenBalances ?? [])
        .filter((balance) => balance.mint === USDC_MINT)
        .reduce((sum, balance) => sum + (balance.uiTokenAmount.uiAmount ?? 0), 0);

      actualOutputUsdcMicro = Math.round((postUsdc - preUsdc) * 1_000_000);
    }

    if (!Number.isFinite(actualOutputUsdcMicro)) {
      throw new Error('actualOutputUsdcMicro is required (or provide swapSignature)');
    }
    const verifiedOutputUsdcMicro = actualOutputUsdcMicro as number;

    const actualOutputUsdc = verifiedOutputUsdcMicro / 1_000_000;
    const expectedOutputUsdc = params.swapSizeUsd;
    const actualSlippageBps = expectedOutputUsdc <= 0
      ? 0
      : Math.max(0, Math.round(((expectedOutputUsdc - actualOutputUsdc) / expectedOutputUsdc) * 10_000));

    const covered = actualSlippageBps > 50;
    const payoutLamports = covered
      ? Math.ceil((params.swapSizeUsd * 0.005 * anchor.web3.LAMPORTS_PER_SOL) / DEFAULT_SOL_PRICE_USD)
      : 0;

    return {
      outcome: covered ? 'covered' : 'not_covered',
      payoutLamports,
      signature: `mock_${params.sequenceNumber}_${Date.now()}`,
    };
  }
}

export default KestrelSDK;
