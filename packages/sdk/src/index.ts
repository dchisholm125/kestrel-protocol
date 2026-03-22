/**
 * Kestrel Protocol - Public SDK
 * Slippage insurance for Solana Jupiter swaps
 */

export { KestrelSDK } from './KestrelSDK.js';
export type { KestrelSDKOptions } from './KestrelSDK.js';

export type {
  MarketState,
  MarketRegime,
  GuaranteeOption,
  ProtectParams,
  Policy,
  SettleParams,
  Settlement,
  SettlementOutcome,
  SwapDirection,
} from './types.js';

export {
  MAINNET_PROGRAM_ID,
  DEVNET_PROGRAM_ID,
  MAINNET_VAULT_PDA,
  DEFAULT_SOL_PRICE_USD,
  GUARANTEE_TIERS,
} from './constants.js';

// Re-export for convenience
export { default } from './KestrelSDK.js';
