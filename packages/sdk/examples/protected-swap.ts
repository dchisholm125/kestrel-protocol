import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { Connection, Keypair } from '@solana/web3.js';
import { KestrelSDK } from '../src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const SOL_MINT = process.env.INPUT_MINT ?? 'So11111111111111111111111111111111111111112';
const USDC_MINT = process.env.OUTPUT_MINT ?? 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const AMOUNT_LAMPORTS = Number(process.env.AMOUNT_LAMPORTS ?? '10000000');

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseKeypair(value: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(value) as number[]));
}

function formatTokenAmount(rawAmount: number, decimals: number): string {
  return (rawAmount / (10 ** decimals)).toFixed(Math.min(decimals, 6));
}

async function main(): Promise<void> {
  const rpcUrl = requireEnv('RPC_URL');
  const wallet = parseKeypair(requireEnv('WALLET_KEY'));
  const settler = process.env.KESTREL_SETTLER_KEY
    ? parseKeypair(process.env.KESTREL_SETTLER_KEY)
    : wallet;

  const connection = new Connection(rpcUrl, 'confirmed');
  const kestrel = new KestrelSDK({
    network: (process.env.KESTREL_NETWORK as 'mainnet-beta' | 'devnet') ?? 'mainnet-beta',
    wallet,
    settler,
    connection,
    programId: process.env.KESTREL_PROGRAM_ID,
    solPriceProvider: async () => {
      const fallback = Number(process.env.SOL_PRICE_USD ?? '150');
      return Number.isFinite(fallback) && fallback > 0 ? fallback : 150;
    },
  });

  const market = await kestrel.getMarket();
  console.log(`Regime: ${market.regime}`);
  console.log(`Premium: ${market.premiumBps}bps`);

  const quote = await kestrel.quoteProtectedSwap({
    inputMint: SOL_MINT,
    outputMint: USDC_MINT,
    amountLamports: AMOUNT_LAMPORTS,
  });

  console.log(`Jupiter quote: ${formatTokenAmount(quote.expectedOutputAmount, quote.expectedOutputDecimals)}`);
  console.log(`Kestrel premium: ${quote.premiumLamports} lamports`);
  console.log(`Guaranteed max slippage: +/-${quote.guaranteedBps}bps`);

  const result = await kestrel.executeProtectedSwap(quote);

  console.log(`Swap tx: ${result.swapSignature}`);
  console.log(`Policy: ${result.policyAddress}`);
  console.log(`Actual slippage: ${result.actualSlippageBps}bps`);
  console.log(`Outcome: ${result.outcome}`);
  console.log(`Payout: ${result.payoutLamports} lamports`);
  console.log(`Vault net: ${result.vaultNetLamports} lamports`);
  console.log(`Solscan swap: ${result.solscanSwap}`);
  console.log(`Solscan policy: ${result.solscanPolicy}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
