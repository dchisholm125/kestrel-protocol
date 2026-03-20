import { KestrelSdk } from '../packages/sdk/src/index.js';

async function main(): Promise<void> {
  const sdk = new KestrelSdk({
    marketProvider: async () => ({
      regime: 'CALM',
      currentBreachRate: 0.029,
      premiumBps: 20,
      explanation: 'Example devnet market state',
      vaultOpen: true,
      coveredBps: 75,
      liabilityCapBps: 100,
      capitalGamma: 0.06,
    }),
  });

  const market = await sdk.getMarket();
  const quote = sdk.quote({
    inputMint: 'So11111111111111111111111111111111111111112',
    outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    amountUsd: 10,
    market,
    solPriceUsd: 150,
  });

  console.log({ market, quote });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
