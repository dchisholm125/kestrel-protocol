import type { RouteInfo } from '@jup-ag/core';
import type { Cluster, Connection, Keypair, PublicKey } from '@solana/web3.js';

export type Awaitable<T> = T | Promise<T>;
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

export interface KestrelSDKOptions {
  network?: Cluster;
  wallet?: Keypair;
  settler?: Keypair;
  connection?: Connection;
  programId?: PublicKey | string;
  marketProvider?: () => Awaitable<KestrelMarketState>;
  solPriceProvider?: () => Awaitable<number>;
  quoteTtlMs?: number;
  routeSlippageBufferBps?: number;
}

export interface ProtectedSwapQuoteParams {
  inputMint: string;
  outputMint: string;
  amountLamports: number;
  guaranteedSlippageBps?: number;
}

export interface ProtectedSwapPricingSnapshot {
  solPriceUsd: number;
  swapSizeUsd: number;
  outputTokenUsdPrice: number | null;
}

export interface ProtectedSwapQuote {
  inputMint: string;
  outputMint: string;
  amountLamports: number;
  expectedOutputAmount: number;
  expectedOutputDecimals: number;
  guaranteedBps: number;
  premiumLamports: number;
  premiumBps: number;
  regime: MarketRegime;
  validUntil: Date;
  _jupiterRoute: RouteInfo;
  _market: KestrelMarketState;
  _pricing: ProtectedSwapPricingSnapshot;
}

export interface ProtectedSwapResult {
  policyAddress: string;
  swapSignature: string;
  actualSlippageBps: number;
  guaranteedBps: number;
  outcome: 'KEPT_PREMIUM' | 'PAID_CLAIM';
  premiumPaidLamports: number;
  payoutLamports: number;
  vaultNetLamports: number;
  solscanSwap: string;
  solscanPolicy: string;
}
