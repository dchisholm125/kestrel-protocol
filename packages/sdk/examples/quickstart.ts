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
