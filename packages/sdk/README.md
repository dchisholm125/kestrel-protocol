# @kestrel-protocol/sdk

TypeScript SDK for Kestrel Protocol.

This package is the public developer-facing entry point for integrating Kestrel-style execution protection into bots, wallets, or routing workflows.

## Current scope

This initial SDK provides:
- market state types
- premium / payout math helpers
- protection preparation helpers
- a small `KestrelSdk` class wrapper

It is intentionally lightweight and designed to evolve alongside the public protocol repo.

## Install

```bash
npm install @kestrel-protocol/sdk
```

## Example

```ts
import { KestrelSdk } from '@kestrel-protocol/sdk';

const sdk = new KestrelSdk();

const prepared = sdk.prepare({
  amountUsd: 10,
  maxTotalCostBps: 80,
  market: {
    regime: 'CALM',
    currentBreachRate: 0.029,
    premiumBps: 20,
    explanation: 'Normal market conditions',
    vaultOpen: true,
    coveredBps: 75,
    liabilityCapBps: 100,
    capitalGamma: 0.06,
  },
  solPriceUsd: 150,
});

console.log(prepared);
```

## Design goal

The long-term developer experience should feel like:

> turn this swap into a protected swap with one extra step

This package is the beginning of that public integration surface.
