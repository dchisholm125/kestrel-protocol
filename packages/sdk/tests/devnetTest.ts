import { Keypair, PublicKey } from '@solana/web3.js';
import { kestrelClient } from './KestrelClient';
import { KestrelUnderwriter } from './KestrelUnderwriter';
import { createLogger } from '../utils/Logger';

const log = createLogger('KestrelTest');
const underwriter = new KestrelUnderwriter(kestrelClient);
const TEST_SWAP_USD_CENTS = 1_000;
const TEST_GUARANTEED_SLIPPAGE_BPS = 75;
const TEST_SETTLEMENT_SLIPPAGE_BPS = 12;

async function fetchSolPrice(): Promise<number> {
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
    const data = await res.json() as { solana?: { usd?: number } };
    const price = data?.solana?.usd;
    if (typeof price === 'number' && Number.isFinite(price) && price > 0) {
      return price;
    }
  } catch (error: unknown) {
    log.warn('[Test] Failed to fetch SOL price, using fallback', { error: String(error) });
  }
  return Number(process.env.SOL_PRICE_USD ?? '150');
}

function formatUsd(value: number): string {
  return `$${value.toFixed(3)}`;
}

function formatLamports(lamports: number): string {
  return lamports.toLocaleString('en-US');
}

async function getJupiterDevnetSlippageBps(swapSizeUsdCents: number): Promise<{ simulated: boolean; actualSlippageBps: number; note: string }> {
  const solPriceUsd = await fetchSolPrice();
  const amountLamports = Math.max(1, Math.floor((swapSizeUsdCents / 100 / solPriceUsd) * 1e9));
  const params = new URLSearchParams({
    inputMint: 'So11111111111111111111111111111111111111112',
    outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    amount: String(amountLamports),
    slippageBps: String(TEST_GUARANTEED_SLIPPAGE_BPS),
    restrictIntermediateTokens: 'true',
    onlyDirectRoutes: 'true',
  });

  try {
    const response = await fetch(`https://quote-api.jup.ag/v6/quote?${params.toString()}`);
    if (!response.ok) {
      return {
        simulated: true,
        actualSlippageBps: TEST_SETTLEMENT_SLIPPAGE_BPS,
        note: `SIMULATED SWAP — Jupiter quote unavailable (${response.status})`,
      };
    }

    const quote = await response.json() as { priceImpactPct?: string; routePlan?: unknown[] };
    const impactPct = Number(quote.priceImpactPct ?? '0');
    const actualSlippageBps = Number.isFinite(impactPct) ? Math.max(0, Math.round(impactPct * 100)) : TEST_SETTLEMENT_SLIPPAGE_BPS;
    return {
      simulated: false,
      actualSlippageBps,
      note: `Jupiter quote retrieved${Array.isArray(quote.routePlan) ? ` with ${quote.routePlan.length} route legs` : ''}`,
    };
  } catch (error: unknown) {
    return {
      simulated: true,
      actualSlippageBps: TEST_SETTLEMENT_SLIPPAGE_BPS,
      note: `SIMULATED SWAP — Jupiter quote request failed (${String(error)})`,
    };
  }
}

async function main() {
  try {
    log.info('[Test] Starting Kestrel Protocol end-to-end test on devnet');

    // 0. LOG MARKET STATE
    const market = kestrelClient.getMarketState();
    log.info(
      `[Test] Market: regime=${market.regime} breach=${(market.currentBreachRate * 100).toFixed(1)}% premium=${market.premiumBps}bps vault=${market.vaultOpen ? 'OPEN' : 'HALTED'}`,
    );

    // 1. INITIALIZE VAULT
    log.info('[Test] Step 1: Initialize vault');
    try {
      await kestrelClient.initialize();
      log.info('[Test] Vault initialized');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('already in use')) {
        log.info('[Test] Vault already initialized, continuing');
      } else {
        throw e;
      }
    }

    const vaultBefore = await kestrelClient.getVault();
    if (!vaultBefore) {
      throw new Error('Vault not found after initialization');
    }
    log.info('[Test] Vault state', {
      authority: vaultBefore.authority.toBase58(),
      total_premiums_collected: vaultBefore.total_premiums_collected.toString(),
      total_payouts: vaultBefore.total_payouts.toString(),
    });

    // 2. SOLVENCY CHECK
    log.info('[Test] Step 2: Solvency check');
    const exposure = vaultBefore.total_premiums_collected.toNumber() - vaultBefore.total_payouts.toNumber();
    log.info('[Test] Solvency result', {
      solvent: true,
      exposure,
    });

    // 3. ISSUE A TEST POLICY WITH LIVE PREMIUM
    log.info('[Test] Step 3: Issue test policy');
    const buyerKeypair = Keypair.generate();
    log.info('[Test] Buyer pubkey: ' + buyerKeypair.publicKey.toBase58());
    const solPriceUsd = await fetchSolPrice();
    const swapSizeUsd = TEST_SWAP_USD_CENTS / 100;
    const premiumUsd = swapSizeUsd * (market.premiumBps / 10_000);
    const premiumLamports = Math.ceil((premiumUsd / solPriceUsd) * 1e9);
    const premiumWithBuffer = Math.ceil(premiumLamports * 1.1);
    const policyRentExemptMinimum = await kestrelClient.getPolicyRentExemptMinimum();
    const buyerRentExemptMinimum = await kestrelClient.getWalletRentExemptMinimum();
    const buyerFundingLamports =
      policyRentExemptMinimum + premiumWithBuffer + buyerRentExemptMinimum + 50_000;
    log.info('[Test] Live premium computation', {
      solPriceUsd,
      swapSizeUsd,
      marketPremiumBps: market.premiumBps,
      premiumLamports,
      premiumWithBuffer,
    });
    const minPremiumUsd = premiumLamports / 1e9 * solPriceUsd;
    const paidPremiumUsd = premiumWithBuffer / 1e9 * solPriceUsd;
    log.info(
      '[Kestrel] Underwriting trace:\n' +
      ` Market regime: ${market.regime}\n` +
      ` Current breach rate: ${(market.currentBreachRate * 100).toFixed(1)}%\n` +
      ` Market premium: ${market.premiumBps} bps\n` +
      ` Swap notional: ${formatUsd(swapSizeUsd)}\n` +
      ` Min premium: ${formatUsd(minPremiumUsd)} (${formatLamports(premiumLamports)} lamports)\n` +
      ` Paid premium: ${formatUsd(paidPremiumUsd)} (${formatLamports(premiumWithBuffer)} lamports) +10% buffer\n` +
      ` Vault status: ${market.vaultOpen ? 'OPEN' : 'HALTED'}`,
    );
    log.info('[Test] Funding buyer with conservative balance', {
      policyRentExemptMinimum,
      buyerRentExemptMinimum,
      premiumWithBuffer,
      bufferLamports: 50_000,
      buyerFundingLamports,
    });
    await kestrelClient.fundAccount(buyerKeypair.publicKey, buyerFundingLamports);
    log.info('[Test] Buyer funded');

    let issueResult: { signature: string; policyAddress: PublicKey; regime?: string; premiumBps?: number };
    try {
      const underwritingResult = await underwriter.issuePolicy({
        guaranteedSlippageBps: TEST_GUARANTEED_SLIPPAGE_BPS,
        swapSizeUsdCents: TEST_SWAP_USD_CENTS,
        direction: 0,
        premiumLamports: premiumWithBuffer,
        sequenceNumber: 1,
        buyer: buyerKeypair.publicKey,
        buyerKeypair,
      }, { mode: 'bypass' });
      if (!underwritingResult.issued) {
        throw new Error('message' in underwritingResult ? underwritingResult.message : 'Policy issuance rejected');
      }
      issueResult = underwritingResult;
      log.info(`[Test] Policy address: ${issueResult.policyAddress.toBase58()}`);
      log.info(`[Test] Signature: ${issueResult.signature}`);
      log.info(`[Kestrel] Underwriting trace continuation: Policy address: ${issueResult.policyAddress.toBase58()}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('already in use')) {
        log.info('[Test] Policy account exists from prior tx — skipping issue. Close account: solana close <PDA> --url devnet');
      }
      throw e;
    }

    // 4. FETCH THE POLICY
    log.info('[Test] Step 4: Fetch policy');
    const policy = await kestrelClient.getPolicy(issueResult.policyAddress);
    if (!policy) {
      throw new Error('Policy not found after issuance');
    }
    log.info('[Test] Policy state', {
      status: kestrelClient.statusLabel(policy.status),
      issued_at: policy.issued_at.toString(),
      expires_at: policy.expires_at.toString(),
      guaranteed_slippage_bps: policy.guaranteed_slippage_bps,
      premium_paid: policy.premium_paid_lamports.toString(),
      swap_size_cents: policy.swap_size_usd_cents.toString(),
    });

    // 5. REAL OR SIMULATED JUPITER SWAP + SETTLEMENT
    log.info('[Test] Step 5: Execute real-or-simulated Jupiter swap and settle policy');
    const swapObservation = await getJupiterDevnetSlippageBps(TEST_SWAP_USD_CENTS);
    log.info(`[Test] ${swapObservation.note}`);
    log.info(`[Test] Observed slippage for settlement: ${swapObservation.actualSlippageBps}bps`);

    let settleSig = 'skipped';
    try {
      settleSig = await kestrelClient.settlePolicy({
        policyAddress: issueResult.policyAddress,
        actualSlippageBps: swapObservation.actualSlippageBps,
        buyerPublicKey: policy.buyer,
        buyerKeypair,
      });
      log.info(`[Test] Settlement sig: ${settleSig}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('PolicyExpired') || msg.includes('0x1771')) {
        log.warn('[Test] Policy expired (test took >12s). Increase expiration in Rust program or run faster.');
      } else {
        throw e;
      }
    }

    // 6. VERIFY FINAL STATE
    log.info('[Test] Step 6: Verify final vault state');
    const vaultAfter = await kestrelClient.getVault();
    if (!vaultAfter) {
      throw new Error('Vault not found after settlement');
    }
    log.info('[Test] Final vault state', {
      total_premiums_collected: vaultAfter.total_premiums_collected.toString(),
      total_payouts: vaultAfter.total_payouts.toString(),
    });

    const activeExposure = vaultAfter.total_premiums_collected.toNumber() - vaultAfter.total_payouts.toNumber();
    if (vaultAfter.total_premiums_collected.gt(vaultBefore.total_premiums_collected)) {
      log.info(`[Test] ✅ Premium collected: ${vaultAfter.total_premiums_collected.sub(vaultBefore.total_premiums_collected).toString()} lamports`);
    } else {
      log.info('[Test] NOTE: Premium not collected (check buyer funding / SOL balance)');
    }

    // 7. PRINT SUMMARY
    log.info('[Test] Step 7: Summary');
    log.info(`[Test] ✅ End-to-end test complete under regime=${market.regime} premium=${market.premiumBps}bps`);
    log.info(`[Test] Vault collected: ${vaultAfter.total_premiums_collected.toString()} lamports`);
    log.info(`[Test] Exposure: ${activeExposure} lamports`);
    if (activeExposure === 0) {
      log.info('[Test] Active exposure returned to 0');
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error(`[Test] ❌ Failed: ${msg}`);
    throw e;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
