# @kestrel-protocol/sdk

Slippage insurance for Solana Jupiter swaps.

## Install

```bash
npm install @kestrel-protocol/sdk
```

## Quickstart

```typescript
import { KestrelSDK } from '../src/index.js';

async function main() {
  const rpcUrl = process.env.RPC_URL ?? 'https://api.mainnet-beta.solana.com';
  const swapSizeUsd = Number(process.env.SWAP_SIZE_USD ?? '1000');
  const guaranteedBps = Number(process.env.GUARANTEED_BPS ?? '25');
  const direction = (process.env.SWAP_DIRECTION as 'Buy' | 'Sell') ?? 'Buy';
  const actualSlippageBps = Number(process.env.ACTUAL_SLIPPAGE_BPS ?? '30');

  const sdk = new KestrelSDK({ rpcUrl });

  const market = await sdk.getMarket();
  console.log('Market:', market.regime, `premium=${market.premiumBps}bps`);

  const policy = await sdk.protect({
    swapSizeUsd,
    guaranteedBps,
    direction,
  });
  console.log('Policy:', policy.policyAddress.toBase58(), `premium=${policy.premiumLamports} lamports`);

  // Jupiter swap execution happens here (example):
  // const swapSig = await executeJupiterSwap({ swapSizeUsd, direction, maxSlippageBps: guaranteedBps });

  const settlement = await sdk.settle({
    policyAddress: policy.policyAddress,
    actualSlippageBps,
    swapSizeUsd,
    sequenceNumber: 0,
  });

  console.log('Settlement:', settlement.outcome, `payout=${settlement.payoutLamports} lamports`);
  console.log('Signature:', settlement.signature);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

## Coverage Tiers

| Guarantee | Premium | Use Case |
|-----------|---------|----------|
| ±75 bps   | 20 bps  | Casual trading |
| ±25 bps   | 30 bps  | Active traders |
| ±10 bps   | 50 bps  | Bots |
| ±5 bps    | 80 bps  | Systematic |
| ±1 bps    | 200 bps | Precision |

## API Reference

### getMarket()

Returns current market conditions and available tiers.

```typescript
export interface MarketState {
  regime: MarketRegime;
  premiumBps: number;
  vaultOpen: boolean;
  guaranteeOptions: GuaranteeOption[];
  breachRate: number;
  coveredBps: number;
}
```

### protect(params)

Issues a slippage guarantee policy before your swap.

```typescript
export interface ProtectParams {
  swapSizeUsd: number;
  guaranteedBps: number;
  direction: SwapDirection;
}

export interface Policy {
  policyAddress: PublicKey;
  premiumLamports: number;
  premiumBps: number;
  expiresAt: number;
  regime: MarketRegime;
}
```

### settle(params)

Settles the policy after swap execution.

```typescript
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
```

## Live Proof

Program: 46PW8Yrw8KNtgLcmBEW9GQPjaYQJUxJSxM8KPBMJ5RMS

Real mainnet payout transactions:
- Policy:  4DgqNU6rRGamXMEnjL1fPwfHnJUmHpggDuZiW2MLCjpawYHLpxDAU5uwPo64BuoZLCbjUbgPB8ghcudE3NgGsrMu
- Swap:    4MojWcsUBqEG5DJMNFxt4wxxEp7qwNyFwjB26GBp2wk86mUMwBb9Nq1yceE32P1SmTLt623NhVwYw9kz4Rt95TXS
- Payout:  5EGSZsGAnsQozYCUFLHfRqLw5PnyjP3vaMGapJtHpX2PXGZYL2K8srhnCvQaxtUQ9XEDtC1DaYJac4FC8zxbFBhT

## Status

✅ Live on Solana mainnet-beta
✅ Payout path proven on-chain
⚠️  Not audited — use at your own risk

## Protocol

Source: https://github.com/kestrel-protocol/kestrel-protocol
