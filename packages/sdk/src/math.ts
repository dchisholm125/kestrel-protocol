import type {
  KestrelPrepareProtectionInput,
  KestrelPrepareProtectionResult,
  ProtectionQuote,
  ProtectionQuoteRequest,
  SettlementPreview,
  SettlementPreviewInput,
} from './types.js';

export function computePremiumLamports(
  amountUsd: number,
  premiumBps: number,
  solPriceUsd: number,
  bufferMultiplier = 1.1,
): number {
  const premiumUsd = amountUsd * (premiumBps / 10_000);
  return Math.ceil((premiumUsd / solPriceUsd) * 1e9 * bufferMultiplier);
}

export function createProtectionQuote(input: ProtectionQuoteRequest): ProtectionQuote {
  const guaranteedSlippageBps = input.guaranteedSlippageBps ?? input.market.coveredBps;
  const premiumUsd = input.amountUsd * (input.market.premiumBps / 10_000);
  const premiumLamports = computePremiumLamports(
    input.amountUsd,
    input.market.premiumBps,
    input.solPriceUsd,
  );

  return {
    premiumBps: input.market.premiumBps,
    premiumUsd,
    premiumLamports,
    guaranteedSlippageBps,
    regime: input.market.regime,
    explanation: input.market.explanation,
  };
}

export function previewSettlement(input: SettlementPreviewInput): SettlementPreview {
  const excessBps = Math.max(0, input.actualSlippageBps - input.guaranteedSlippageBps);
  const payoutUsd = (excessBps / 10_000) * input.swapSizeUsd;
  const payoutLamports = Math.ceil((payoutUsd / input.solPriceUsd) * 1e9);

  return {
    excessBps,
    payoutUsd,
    payoutLamports,
  };
}

export function prepareProtection(input: KestrelPrepareProtectionInput): KestrelPrepareProtectionResult {
  const premiumUsd = input.amountUsd * (input.market.premiumBps / 10_000);
  const premiumLamports = computePremiumLamports(
    input.amountUsd,
    input.market.premiumBps,
    input.solPriceUsd,
  );

  return {
    premiumBps: input.market.premiumBps,
    premiumUsd,
    premiumLamports,
    guaranteedSlippageBps: input.market.coveredBps,
    regime: input.market.regime,
    maxTotalCostBps: input.maxTotalCostBps,
  };
}
