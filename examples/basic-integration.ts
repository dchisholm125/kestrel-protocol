import { KestrelSdk } from '../packages/sdk/src/index.js';

const sdk = new KestrelSdk();

const result = sdk.prepare({
  amountUsd: 25,
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

console.log(result);
