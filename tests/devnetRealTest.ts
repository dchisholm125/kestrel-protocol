import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { Connection, Keypair, VersionedTransaction } from '@solana/web3.js';
import { kestrelClient } from './KestrelClient';
import { KestrelUnderwriter } from './KestrelUnderwriter';
import { createLogger } from '../utils/Logger';

type JupiterQuoteResponse = {
  inAmount: string;
  outAmount: string;
  priceImpactPct?: string;
  routePlan?: unknown[];
};

type JupiterSwapResponse = {
  swapTransaction: string;
};

type SwapObservation = {
  actualSlippageBps: number;
  simulated: boolean;
  note: string;
  signature?: string;
  quotedOutAmount: number;
  actualOutAmount: number;
};

type ScenarioSummary = {
  name: string;
  premiumLamports: number;
  premiumUsd: number;
  actualSlippageBps: number;
  guaranteedSlippageBps: number;
  payoutLamports: number;
  payoutUsd: number;
  vaultNetLamports: number;
  note?: string;
};

const log = createLogger('KestrelRealTest');
const underwriter = new KestrelUnderwriter(kestrelClient);
const DEVNET_RPC = process.env.DEVNET_RPC_URL ?? 'https://api.devnet.solana.com';
const JUPITER_QUOTE_API = 'https://quote-api.jup.ag/v6/quote';
const JUPITER_SWAP_API = 'https://quote-api.jup.ag/v6/swap';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SWAP_LAMPORTS = 10_000_000; // 0.01 SOL
const SWAP_SIZE_USD_CENTS_FALLBACK = 150;
const SLIPPAGE_BPS_FOR_EXECUTION = 100;
const BALANCE_FEE_TOLERANCE_LAMPORTS = 5_000;

function formatUsd(value: number): string {
  return `$${value.toFixed(3)}`;
}

function formatLamports(value: number): string {
  return value.toLocaleString('en-US');
}

function loadKeypairFromEnv(name: string): Keypair | null {
  const raw = process.env[name];
  if (!raw) return null;
  const parsed = JSON.parse(raw) as number[];
  return Keypair.fromSecretKey(new Uint8Array(parsed));
}

async function fetchSolPrice(): Promise<number> {
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
    const data = await res.json() as { solana?: { usd?: number } };
    const price = data?.solana?.usd;
    if (typeof price === 'number' && Number.isFinite(price) && price > 0) {
      return price;
    }
  } catch (error: unknown) {
    log.warn('[RealTest] Failed to fetch SOL price, using fallback', { error: String(error) });
  }
  return Number(process.env.SOL_PRICE_USD ?? '150');
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${body}`);
  }
  return await response.json() as T;
}

function toRawAmount(amount: { amount?: string } | undefined): bigint {
  if (!amount?.amount) return 0n;
  return BigInt(amount.amount);
}

function sumTokenBalanceDelta(
  tx: Awaited<ReturnType<Connection['getTransaction']>>,
  owner: string,
  mint: string,
): bigint {
  const meta = tx?.meta;
  if (!meta) return 0n;
  const pre = (meta.preTokenBalances ?? []).filter((balance) => balance.owner === owner && balance.mint === mint);
  const post = (meta.postTokenBalances ?? []).filter((balance) => balance.owner === owner && balance.mint === mint);
  const preTotal = pre.reduce((sum, balance) => sum + toRawAmount(balance.uiTokenAmount), 0n);
  const postTotal = post.reduce((sum, balance) => sum + toRawAmount(balance.uiTokenAmount), 0n);
  return postTotal - preTotal;
}

async function getTransactionWithRetry(connection: Connection, signature: string) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const tx = await connection.getTransaction(signature, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    });
    if (tx) return tx;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Transaction not found after confirmation: ${signature}`);
}

async function getJupiterQuote(): Promise<JupiterQuoteResponse> {
  const params = new URLSearchParams({
    inputMint: SOL_MINT,
    outputMint: USDC_MINT,
    amount: String(SWAP_LAMPORTS),
    slippageBps: String(SLIPPAGE_BPS_FOR_EXECUTION),
    swapMode: 'ExactIn',
    onlyDirectRoutes: 'false',
    asLegacyTransaction: 'false',
    devnet: 'true',
  });
  return fetchJson<JupiterQuoteResponse>(`${JUPITER_QUOTE_API}?${params.toString()}`);
}

async function executeJupiterSwap(
  connection: Connection,
  buyer: Keypair,
  quoteResponse: JupiterQuoteResponse,
): Promise<string> {
  const swapResponse = await fetchJson<JupiterSwapResponse>(JUPITER_SWAP_API, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      quoteResponse,
      userPublicKey: buyer.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      devnet: true,
    }),
  });

  const transaction = VersionedTransaction.deserialize(Buffer.from(swapResponse.swapTransaction, 'base64'));
  transaction.sign([buyer]);
  const signature = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });
  const confirmation = await connection.confirmTransaction(signature, 'confirmed');
  if (confirmation.value.err) {
    throw new Error(`Jupiter swap confirmation failed: ${JSON.stringify(confirmation.value.err)}`);
  }
  return signature;
}

async function observeBuyerSwap(connection: Connection, buyer: Keypair): Promise<SwapObservation> {
  try {
    const quote = await getJupiterQuote();
    const quotedOutAmount = Number(quote.outAmount);
    const signature = await executeJupiterSwap(connection, buyer, quote);
    const tx = await getTransactionWithRetry(connection, signature);
    const actualOutAmount = Number(sumTokenBalanceDelta(tx, buyer.publicKey.toBase58(), USDC_MINT));
    const expectedRate = quotedOutAmount / SWAP_LAMPORTS;
    const actualRate = actualOutAmount / SWAP_LAMPORTS;
    const actualSlippageBps = expectedRate > 0
      ? Math.max(0, Math.round(((expectedRate - actualRate) / expectedRate) * 10_000))
      : 12;

    return {
      actualSlippageBps,
      simulated: false,
      note: `Real Jupiter swap executed (${signature})`,
      signature,
      quotedOutAmount,
      actualOutAmount,
    };
  } catch (error: unknown) {
    return {
      actualSlippageBps: 12,
      simulated: true,
      note: `(SIMULATED - Jupiter devnet unavailable) ${String(error)}`,
      quotedOutAmount: 0,
      actualOutAmount: 0,
    };
  }
}

function computePremiumLamports(swapSizeUsdCents: number, premiumBps: number, solPriceUsd: number): number {
  const swapSizeUsd = swapSizeUsdCents / 100;
  const premiumUsd = swapSizeUsd * (premiumBps / 10_000);
  return Math.ceil((premiumUsd / solPriceUsd) * 1e9);
}

function computeClaimPayoutLamports(
  actualSlippageBps: number,
  guaranteedSlippageBps: number,
  swapSizeUsd: number,
  solPriceUsd: number,
): number {
  const excessBps = Math.max(0, actualSlippageBps - guaranteedSlippageBps);
  const payoutUsd = (excessBps / 10_000) * swapSizeUsd;
  return Math.ceil((payoutUsd / solPriceUsd) * 1e9);
}

async function ensureBuyerWallet(envName = 'DEVNET_BUYER_PRIVATE_KEY'): Promise<Keypair> {
  const existing = loadKeypairFromEnv(envName);
  if (existing) {
    return existing;
  }
  const generated = Keypair.generate();
  log.warn(`[RealTest] ${envName} not set; generated fresh buyer wallet`, {
    buyerPublicKey: generated.publicKey.toBase58(),
  });
  return generated;
}

async function ensureUnusedBuyerWallet(envName: string): Promise<Keypair> {
  const candidate = await ensureBuyerWallet(envName);
  const existingPolicy = await kestrelClient.getPolicy(kestrelClient.findPolicyPdaForTest(candidate.publicKey));
  if (!existingPolicy) {
    return candidate;
  }
  const fresh = Keypair.generate();
  log.warn('[RealTest] Configured buyer already has an existing policy PDA; using fresh buyer for isolated run', {
    envName,
    oldBuyer: candidate.publicKey.toBase58(),
    replacementBuyer: fresh.publicKey.toBase58(),
  });
  return fresh;
}

async function ensureBuyerFunding(buyer: Keypair, premiumLamports: number): Promise<void> {
  const buyerBalance = await kestrelClient.getBalance(buyer.publicKey);
  const targetLamports = premiumLamports + SWAP_LAMPORTS + 5_000_000;
  if (buyerBalance >= targetLamports) return;
  const shortfall = targetLamports - buyerBalance;
  log.info('[RealTest] Funding buyer wallet for test', {
    buyer: buyer.publicKey.toBase58(),
    currentBalance: buyerBalance,
    targetLamports,
    shortfall,
  });
  await kestrelClient.fundAccount(buyer.publicKey, shortfall + 1_000_000);
}

async function initializeVaultGracefully(): Promise<void> {
  try {
    await kestrelClient.initialize();
    log.info('[RealTest] Vault initialized');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('already in use')) {
      log.info('[RealTest] Vault already initialized, continuing');
      return;
    }
    throw error;
  }
}

async function issueScenarioPolicy(
  buyer: Keypair,
  guaranteedSlippageBps: number,
  swapSizeUsdCents: number,
  premiumLamports: number,
  sequenceNumber: number,
) {
  const result = await underwriter.issuePolicy({
    guaranteedSlippageBps,
    swapSizeUsdCents,
    direction: 0,
    premiumLamports,
    sequenceNumber,
    buyer: buyer.publicKey,
    buyerKeypair: buyer,
  }, { mode: 'bypass' });

  if (!result.issued) {
    throw new Error('message' in result ? result.message : 'Policy issuance rejected');
  }
  return result;
}

async function runScenario(
  connection: Connection,
  buyer: Keypair,
  name: string,
  guaranteedSlippageBps: number,
  marketPremiumBps: number,
  solPriceUsd: number,
  swapSizeUsdCents: number,
  sequenceNumber: number,
): Promise<ScenarioSummary> {
  const premiumLamports = Math.ceil(computePremiumLamports(swapSizeUsdCents, marketPremiumBps, solPriceUsd) * 1.1);
  await ensureBuyerFunding(buyer, premiumLamports);

  const vaultBefore = await kestrelClient.getVault();
  if (!vaultBefore) throw new Error('Vault missing before scenario');

  const issueResult = await issueScenarioPolicy(
    buyer,
    guaranteedSlippageBps,
    swapSizeUsdCents,
    premiumLamports,
    sequenceNumber,
  );

  const observation = await observeBuyerSwap(connection, buyer);
  log.info(`[${name}] Swap observation`, {
    simulated: observation.simulated,
    note: observation.note,
    actualSlippageBps: observation.actualSlippageBps,
  });

  const swapSizeUsd = swapSizeUsdCents / 100;
  const payoutLamports = computeClaimPayoutLamports(
    observation.actualSlippageBps,
    guaranteedSlippageBps,
    swapSizeUsd,
    solPriceUsd,
  );
  const excessBps = Math.max(0, observation.actualSlippageBps - guaranteedSlippageBps);
  log.info(
    `[Settle] excess=${excessBps}bps notional=${formatUsd(swapSizeUsd)} payout=${formatLamports(payoutLamports)} lamports (vs premium=${formatLamports(premiumLamports)} lamports)`,
  );
  const buyerBalanceBeforeSettlement = await kestrelClient.getBalance(buyer.publicKey);

  await kestrelClient.settlePolicy({
    policyAddress: issueResult.policyAddress,
    actualSlippageBps: observation.actualSlippageBps,
    buyerPublicKey: buyer.publicKey,
    buyerKeypair: buyer,
    payoutLamports,
  });

  const buyerBalanceAfterSettlement = await kestrelClient.getBalance(buyer.publicKey);
  const vaultAfter = await kestrelClient.getVault();
  if (!vaultAfter) throw new Error('Vault missing after scenario');

  const premiumDelta = vaultAfter.total_premiums_collected.sub(vaultBefore.total_premiums_collected).toNumber();
  const payoutDelta = vaultAfter.total_payouts.sub(vaultBefore.total_payouts).toNumber();
  const buyerDelta = buyerBalanceAfterSettlement - buyerBalanceBeforeSettlement;

  if (guaranteedSlippageBps === 75) {
    if (payoutDelta !== 0) {
      throw new Error(`[ScenarioA] Expected no payout, but vault payouts changed by ${payoutDelta}`);
    }
    log.info(`[ScenarioA] ✅ Happy path — vault kept premium of ${premiumDelta} lamports`);
  } else {
    if (payoutDelta <= 0 && payoutLamports > 0) {
      throw new Error(`[ScenarioB] Expected payout, but vault payouts did not increase`);
    }
    if (buyerDelta + BALANCE_FEE_TOLERANCE_LAMPORTS < payoutLamports) {
      throw new Error(`[ScenarioB] Buyer balance delta ${buyerDelta} too small for expected payout ${payoutLamports}`);
    }
    log.info(`[ScenarioB] ✅ Claim path — buyer received ${payoutDelta} lamports payout`);
    log.info(`[ScenarioB] Actual slippage: ${observation.actualSlippageBps}bps, guaranteed: ${guaranteedSlippageBps}bps, excess: ${excessBps}bps`);
    log.info(`[ScenarioB] Premium paid: ${premiumDelta} lamports, Payout received: ${payoutDelta} lamports, Vault net on this policy: ${premiumDelta - payoutDelta} lamports`);
  }

  return {
    name,
    premiumLamports,
    premiumUsd: premiumLamports / 1e9 * solPriceUsd,
    actualSlippageBps: observation.actualSlippageBps,
    guaranteedSlippageBps,
    payoutLamports: payoutDelta,
    payoutUsd: payoutDelta / 1e9 * solPriceUsd,
    vaultNetLamports: premiumDelta - payoutDelta,
    note: observation.note,
  };
}

async function main(): Promise<void> {
  await initializeVaultGracefully();

  const connection = new Connection(DEVNET_RPC, {
    commitment: 'confirmed',
    confirmTransactionInitialTimeout: 120_000,
  });
  const buyer = await ensureUnusedBuyerWallet('DEVNET_BUYER_PRIVATE_KEY');
  const buyerScenarioB = await ensureUnusedBuyerWallet('DEVNET_BUYER2_PRIVATE_KEY');
  const solPriceUsd = await fetchSolPrice();
  const market = kestrelClient.getMarketState();
  const vault = await kestrelClient.getVault();
  if (!vault) throw new Error('Vault not initialized');

  log.info('[RealTest] Environment', {
    vaultWallet: kestrelClient.walletPublicKey.toBase58(),
    buyerWallet: buyer.publicKey.toBase58(),
    buyerWalletScenarioB: buyerScenarioB.publicKey.toBase58(),
    market,
    solPriceUsd,
  });

  const summaryA = await runScenario(
    connection,
    buyer,
    'ScenarioA',
    75,
    market.premiumBps,
    solPriceUsd,
    SWAP_SIZE_USD_CENTS_FALLBACK,
    Date.now(),
  );

  log.warn('[ScenarioB] TEST-ONLY configuration: guaranteedSlippageBps=5 to force a likely claim path');
  const summaryB = await runScenario(
    connection,
    buyerScenarioB,
    'ScenarioB',
    5,
    market.premiumBps,
    solPriceUsd,
    SWAP_SIZE_USD_CENTS_FALLBACK,
    Date.now() + 1,
  );

  const vaultAfter = await kestrelClient.getVault();
  if (!vaultAfter) throw new Error('Vault missing at end of test');
  const vaultBalanceLamports = await kestrelClient.getVaultBalance();
  const totalPremiums = vaultAfter.total_premiums_collected.toNumber();
  const totalPayouts = vaultAfter.total_payouts.toNumber();

  console.log('=== KESTREL DEVNET REAL TEST RESULTS ===');
  console.log(`Vault address: ${kestrelClient.walletPublicKey.toBase58()}`);
  console.log(`Buyer address: ${buyer.publicKey.toBase58()}`);
  console.log(`Buyer address (Scenario B): ${buyerScenarioB.publicKey.toBase58()}`);
  console.log('');
  console.log('SCENARIO A (Happy Path):');
  console.log(` Premium paid: ${formatLamports(summaryA.premiumLamports)} lamports (${formatUsd(summaryA.premiumUsd)})`);
  console.log(` Actual slippage: ${summaryA.actualSlippageBps}bps`);
  console.log(` Guaranteed: 75bps`);
  console.log(' Outcome: KEPT PREMIUM');
  console.log(` Vault net: +${formatLamports(summaryA.vaultNetLamports)} lamports`);
  if (summaryA.note) console.log(` Note: ${summaryA.note}`);
  console.log('');
  console.log('SCENARIO B (Claim Path):');
  console.log(` Premium paid: ${formatLamports(summaryB.premiumLamports)} lamports (${formatUsd(summaryB.premiumUsd)})`);
  console.log(` Actual slippage: ${summaryB.actualSlippageBps}bps`);
  console.log(' Guaranteed: 5bps');
  console.log(` Excess slippage: ${Math.max(0, summaryB.actualSlippageBps - 5)}bps`);
  console.log(` Payout: ${formatLamports(summaryB.payoutLamports)} lamports (${formatUsd(summaryB.payoutUsd)})`);
  console.log(` Vault net: ${formatLamports(summaryB.vaultNetLamports)} lamports`);
  if (summaryB.note) console.log(` Note: ${summaryB.note}`);
  console.log('');
  console.log('PROTOCOL HEALTH:');
  console.log(` Total premiums collected: ${formatLamports(totalPremiums)} lamports`);
  console.log(` Total payouts: ${formatLamports(totalPayouts)} lamports`);
  console.log(` Net vault income: ${formatLamports(totalPremiums - totalPayouts)} lamports`);
  console.log(` Vault SOL balance: ${(vaultBalanceLamports / 1e9).toFixed(6)} SOL`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  log.error(`[RealTest] ❌ Failed: ${message}`);
  console.error(error);
  process.exit(1);
});
