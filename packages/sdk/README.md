# @kestrel-protocol/sdk

TypeScript SDK for Kestrel Protocol protected swaps.

The public integration target is:
- create a `KestrelSDK`
- call `getMarket()`
- call `quoteProtectedSwap()`
- call `executeProtectedSwap()`

## Install

```bash
npm install @kestrel-protocol/sdk
```

## Repo demo

Inside this repo, the runnable SDK demo is:

```bash
cd packages/sdk
npm install
cp .env.example .env
# fill in RPC_URL and WALLET_KEY
npm run example:swap
```

## Example

```ts
import { KestrelSDK } from '@kestrel-protocol/sdk';
import { Connection, Keypair } from '@solana/web3.js';

const connection = new Connection(process.env.RPC_URL!);
const wallet = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(process.env.WALLET_KEY!)),
);

const kestrel = new KestrelSDK({
  network: 'mainnet-beta',
  wallet,
  connection,
});

const market = await kestrel.getMarket();
console.log(`Regime: ${market.regime}`);
console.log(`Premium: ${market.premiumBps}bps`);

const quote = await kestrel.quoteProtectedSwap({
  inputMint: 'So11111111111111111111111111111111111111112',
  outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  amountLamports: 10_000_000,
});

const result = await kestrel.executeProtectedSwap(quote);
console.log(result.swapSignature);
```

## Current limits

- The SDK now wraps Jupiter route discovery, Kestrel policy issuance, swap execution, and automatic settlement.
- The current on-chain program still uses a single policy PDA per buyer wallet, so repeated protected swaps require a fresh buyer key until policy account rotation is added.
- Settlement still depends on the configured Kestrel settler authority. The SDK defaults `settler` to the caller wallet so the repo demo stays simple, but production vaults may use a distinct hot settler key.

## Legacy helpers

The older math-first helpers (`quote`, `prepare`, `previewSettlement`) remain exported so existing mock integrations in this repo keep working while the public SDK surface moves to the protected swap flow.
