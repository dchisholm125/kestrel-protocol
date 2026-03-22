/**
 * Public constants for Kestrel Protocol
 */

export const MAINNET_PROGRAM_ID = '46PW8Yrw8KNtgLcmBEW9GQPjaYQJUxJSxM8KPBMJ5RMS';
export const DEVNET_PROGRAM_ID = '46PW8Yrw8KNtgLcmBEW9GQPjaYQJUxJSxM8KPBMJ5RMS';

export const MAINNET_VAULT_PDA = 'EPGFuH2EnTG5fGvU6GaeAWzfgEUskGe6GozBUJriEu1J';

export const DEFAULT_SOL_PRICE_USD = 150;

// PDA seeds
export const VAULT_SEED = 'vault';
export const POLICY_SEED = 'policy';

// Policy status codes
export const POLICY_STATUS_ACTIVE = 0;
export const POLICY_STATUS_SETTLED_OK = 1;
export const POLICY_STATUS_SETTLED_CLAIM = 2;
export const POLICY_STATUS_EXPIRED = 3;

// Guarantee tiers
export const GUARANTEE_TIERS = [
  { guaranteedBps: 75, premiumBps: 20 },
  { guaranteedBps: 25, premiumBps: 30 },
  { guaranteedBps: 10, premiumBps: 50 },
  { guaranteedBps: 5, premiumBps: 80 },
  { guaranteedBps: 1, premiumBps: 200 },
];
