export type MarketRegime = 'CALM' | 'ELEVATED' | 'HALTED';

export interface KestrelMarketState {
  regime: MarketRegime;
  currentBreachRate: number;
  premiumBps: number;
  explanation: string;
  vaultOpen: boolean;
  coveredBps: number;
  liabilityCapBps: number;
  capitalGamma: number;
}

export interface ProtectionQuoteRequest {
  inputMint: string;
  outputMint: string;
  amountUsd: number;
  guaranteedSlippageBps?: number;
  market: KestrelMarketState;
  solPriceUsd: number;
}

export interface ProtectionQuote {
  premiumBps: number;
  premiumUsd: number;
  premiumLamports: number;
  guaranteedSlippageBps: number;
  regime: MarketRegime;
  explanation: string;
}

export interface SettlementPreviewInput {
  actualSlippageBps: number;
  guaranteedSlippageBps: number;
  swapSizeUsd: number;
  solPriceUsd: number;
}

export interface SettlementPreview {
  excessBps: number;
  payoutUsd: number;
  payoutLamports: number;
}

export interface KestrelPrepareProtectionInput {
  amountUsd: number;
  maxTotalCostBps?: number;
  market: KestrelMarketState;
  solPriceUsd: number;
}

export interface KestrelPrepareProtectionResult {
  premiumBps: number;
  premiumUsd: number;
  premiumLamports: number;
  guaranteedSlippageBps: number;
  regime: MarketRegime;
  maxTotalCostBps?: number;
}
