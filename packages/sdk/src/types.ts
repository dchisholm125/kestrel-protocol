import { PublicKey } from '@solana/web3.js';

/**
 * Public API types for Kestrel Protocol SDK
 */

export type MarketRegime = 'CALM' | 'ELEVATED' | 'HALTED';
export type SwapDirection = 0 | 1;
export type SettlementOutcome = 'covered' | 'not_covered';

export interface MarketState {
  regime: MarketRegime;
  premiumBps: number;
  vaultOpen: boolean;
  guaranteeOptions: GuaranteeOption[];
  breachRate: number;
  coveredBps: number;
}

export interface GuaranteeOption {
  guaranteedBps: number;
  premiumBps: number;
}

export interface ProtectParams {
  swapSizeUsd: number;
  guaranteedBps: number;
  direction?: SwapDirection;
  inputMint?: string;
  outputMint?: string;
}

export interface Policy {
  address: string;
  premiumLamports: number;
  premiumBps: number;
  guaranteedBps: number;
  expiresAt: Date;
  regime: MarketRegime;
  sequenceNumber: number;
}

export interface SettleParams {
  policyAddress: PublicKey;
  actualSlippageBps: number;
  swapSizeUsd: number;
  sequenceNumber: number;
}

export interface Settlement {
  outcome: SettlementOutcome;
  payoutLamports: number;
  signature: string;
}
