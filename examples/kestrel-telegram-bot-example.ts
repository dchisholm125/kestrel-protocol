/**
 * Kestrel Protocol - Telegram Bot Integration Example
 * 
 * Demonstrates a 2-step flow for bot developers to protect their swaps:
 * 1. issuePolicy() - Buy slippage protection right before a swap.
 * 2. settleAndClaim() - Settle the policy after swap confirmation.
 */

import { KestrelSdk, KestrelMarketState } from '../packages/sdk/src/index.js';

// 1. Initialize the SDK
const kestrel = new KestrelSdk();

// Mocked off-chain Market Data (usually fetched via API)
const mockMarket: KestrelMarketState = {
  regime: 'CALM',
  currentBreachRate: 5,
  premiumBps: 15, // 0.15% fee for protection
  explanation: 'Normal devnet conditions',
  vaultOpen: true,
  coveredBps: 20, // Protect against slippage > 20 bps
  liabilityCapBps: 500,
  capitalGamma: 1.2
};

async function protectedSwapExample() {
  const amountUsd = 1000; // $1000 swap
  
  console.log("--- STEP 1: Buy Protection Policy ---");
  // Bot calls this right before sending the swap transaction
  const policyId = await kestrel.issuePolicy({
    inputMint: "So11111111111111111111111111111111111111112", // SOL
    outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
    amountUsd,
    market: mockMarket,
    solPriceUsd: 145.20,
  });

  console.log(`[Bot] Swap transaction sent. Kestrel Policy Issued: ${policyId}`);

  // --- MOCKING SWAP EXECUTION ---
  // In a real bot, wait for 'confirmed' or 'finalized' state here
  const actualSlippageBps = 45; // Simulated bad execution (e.g. 0.45%)

  console.log("\n--- STEP 2: Settle & Claim Payout ---");
  // Called once the swap transaction is successful
  if (actualSlippageBps > mockMarket.coveredBps) {
    const settleSig = await kestrel.settleAndClaim(policyId, actualSlippageBps);
    console.log(`[Bot] Claim Successful! Payout sent to user wallet. Sig: ${settleSig}`);
  } else {
    console.log("[Bot] Slippage within limits. No insurance claim needed.");
  }
}

protectedSwapExample().catch(console.error);
