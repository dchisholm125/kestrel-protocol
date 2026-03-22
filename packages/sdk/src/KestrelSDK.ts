import * as anchor from '@coral-xyz/anchor';
import { Keypair, PublicKey } from '@solana/web3.js';
import type {
  MarketState,
  ProtectParams,
  Policy,
  SettleParams,
  Settlement,
} from './types.js';
import {
  DEFAULT_SOL_PRICE_USD,
  GUARANTEE_TIERS,
  MAINNET_PROGRAM_ID,
} from './constants.js';

export interface KestrelSDKOptions {
  rpcUrl?: string;
  programId?: string;
  commitment?: anchor.web3.Commitment;
}

export class KestrelSDK {
  private readonly programId: PublicKey;
  private readonly rpcUrl: string;
  private readonly commitment: anchor.web3.Commitment;

  constructor(options: KestrelSDKOptions = {}) {
    this.programId = new PublicKey(options.programId ?? MAINNET_PROGRAM_ID);
    this.rpcUrl = options.rpcUrl ?? 'https://api.mainnet-beta.solana.com';
    this.commitment = options.commitment ?? 'confirmed';
  }

  async getMarket(): Promise<MarketState> {
    return {
      regime: 'CALM',
      premiumBps: 20,
      vaultOpen: true,
      guaranteeOptions: [...GUARANTEE_TIERS],
      breachRate: 0.029,
      coveredBps: 75,
    };
  }

  async protect(params: ProtectParams): Promise<Policy> {
    if (!Number.isFinite(params.swapSizeUsd) || params.swapSizeUsd <= 0) {
      throw new Error('swapSizeUsd must be a positive number');
    }
    if (!Number.isFinite(params.guaranteedBps) || params.guaranteedBps <= 0) {
      throw new Error('guaranteedBps must be a positive number');
    }
    if (params.direction !== 'Buy' && params.direction !== 'Sell') {
      throw new Error("direction must be 'Buy' or 'Sell'");
    }

    const tier = GUARANTEE_TIERS.find((item) => item.guaranteedBps === params.guaranteedBps);
    if (!tier) {
      throw new Error(
        `guaranteedBps ${params.guaranteedBps} is unsupported. Allowed: ${GUARANTEE_TIERS.map((item) => item.guaranteedBps).join(', ')}`,
      );
    }

    const premiumUsd = (params.swapSizeUsd * tier.premiumBps) / 10_000;
    const premiumLamports = Math.max(
      1,
      Math.ceil((premiumUsd / DEFAULT_SOL_PRICE_USD) * anchor.web3.LAMPORTS_PER_SOL),
    );

    const expiresAt = Math.floor(Date.now() / 1000) + 24 * 60 * 60;

    return {
      policyAddress: Keypair.generate().publicKey,
      premiumLamports,
      premiumBps: tier.premiumBps,
      expiresAt,
      regime: 'CALM',
    };
  }

  async settle(params: SettleParams): Promise<Settlement> {
    if (!params.policyAddress) {
      throw new Error('policyAddress is required');
    }
    if (!Number.isFinite(params.actualSlippageBps)) {
      throw new Error('actualSlippageBps is required');
    }
    if (!Number.isFinite(params.swapSizeUsd) || params.swapSizeUsd <= 0) {
      throw new Error('swapSizeUsd must be a positive number');
    }
    if (!Number.isFinite(params.sequenceNumber) || params.sequenceNumber < 0) {
      throw new Error('sequenceNumber must be a non-negative number');
    }

    const covered = Math.abs(params.actualSlippageBps) > 50;
    const payoutLamports = covered
      ? Math.ceil((params.swapSizeUsd * 0.005 * anchor.web3.LAMPORTS_PER_SOL) / DEFAULT_SOL_PRICE_USD)
      : 0;

    return {
      outcome: covered ? 'covered' : 'not_covered',
      payoutLamports,
      signature: `mock_${params.sequenceNumber}_${Date.now()}`,
    };
  }
}

export default KestrelSDK;
