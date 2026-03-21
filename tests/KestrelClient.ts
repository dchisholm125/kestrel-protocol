import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { BN } from 'bn.js';
import * as anchor from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { createLogger } from '../utils/Logger';

const log = createLogger('KestrelClient');

const DEVNET_PROGRAM_ID = process.env.DEVNET_PROGRAM_ID ?? '3TaXEUn24hw4SncGP9aFskwSqsbhaZod14QEX2akLFxg';
const DEVNET_RPC = process.env.DEVNET_RPC_URL ?? 'https://api.devnet.solana.com';
const VAULT_SEEDS = ['vault'];
const POLICY_SEEDS = ['policy'];

const IDL: anchor.Idl = {
  address: DEVNET_PROGRAM_ID,
  metadata: { name: 'kestrel', version: '0.1.0', spec: '0.1.0' },
  instructions: [
    {
      name: 'initialize', discriminator: [175, 175, 109, 31, 13, 152, 155, 237],
      accounts: [
        { name: 'vault', writable: true },
        { name: 'authority', writable: true, signer: true },
        { name: 'systemProgram' },
      ], args: [],
    },
    {
      name: 'issue_policy', discriminator: [126, 159, 34, 92, 118, 55, 15, 196],
      accounts: [
        { name: 'vault', writable: true },
        { name: 'policy', writable: true },
        { name: 'buyer', writable: true, signer: true },
        { name: 'systemProgram' },
      ],
      args: [
        { name: 'sequence_number', type: 'u64' },
        { name: 'guaranteed_slippage_bps', type: 'i16' },
        { name: 'swap_size_usd_cents', type: 'u64' },
        { name: 'direction', type: 'u8' },
        { name: 'premium_lamports', type: 'u64' },
      ],
    },
    {
      name: 'settle_policy', discriminator: [180, 234, 21, 174, 50, 214, 91, 113],
      accounts: [
        { name: 'vault', writable: true },
        { name: 'policy', writable: true },
        { name: 'buyer', writable: true, signer: true },
        { name: 'systemProgram' },
      ],
      args: [
        { name: 'actual_slippage_bps', type: 'i16' },
        { name: 'payout_lamports', type: 'u64' },
      ],
    },
    {
      name: 'expire_policy', discriminator: [149, 24, 43, 100, 240, 50, 39, 124],
      accounts: [
        { name: 'vault', writable: true },
        { name: 'policy', writable: true },
      ], args: [],
    },
    {
      name: 'withdraw_profit', discriminator: [246, 31, 231, 85, 253, 136, 120, 168],
      accounts: [
        { name: 'vault', writable: true },
        { name: 'authority', writable: true, signer: true },
        { name: 'systemProgram' },
      ], args: [{ name: 'amount_lamports', type: 'u64' }],
    },
  ],
  accounts: [
    { name: 'GuaranteeVault', discriminator: [56, 87, 79, 193, 119, 150, 45, 128] },
    { name: 'GuaranteePolicy', discriminator: [4, 29, 133, 116, 87, 45, 56, 30] },
  ],
};

type BNType = InstanceType<typeof BN>;

export interface GuaranteeVault {
  authority: PublicKey;
  total_premiums_collected: BNType;
  total_payouts: BNType;
  total_active_exposure: BNType;
  bump: number;
}

export interface GuaranteePolicy {
  buyer: PublicKey;
  premium_paid_lamports: BNType;
  guaranteed_slippage_bps: number;
  swap_size_usd_cents: BNType;
  direction: number;
  issued_at: BNType;
  expires_at: BNType;
  actual_slippage_bps: number;
  status: number;
  sequence_number: BNType;
  bump: number;
}

export interface IssuePolicyParams {
  guaranteedSlippageBps: number;
  swapSizeUsdCents: number;
  direction: number;
  premiumLamports: number;
  sequenceNumber: number;
  buyer?: PublicKey;
  buyerKeypair?: Keypair;
}

export interface IssuePolicyResult {
  signature: string;
  policyAddress: PublicKey;
  regime: 'CALM' | 'ELEVATED' | 'HALTED';
  premiumBps: number;
}

export interface SettlePolicyParams {
  policyAddress: PublicKey;
  actualSlippageBps: number;
  buyerPublicKey: PublicKey;
  buyerKeypair?: Keypair;
  payoutLamports?: number;
}

export interface MarketQuote {
  regime: 'CALM' | 'ELEVATED' | 'HALTED';
  currentBreachRate: number;
  premiumBps: number;
  explanation: string;
  vaultOpen: boolean;
  coveredBps: number;
  liabilityCapBps: number;
  capitalGamma: number;
}

const STATUS_ACTIVE = 0;
const STATUS_SETTLED_OK = 1;
const STATUS_SETTLED_CLAIM = 2;
const STATUS_EXPIRED = 3;

function loadEnvKeypair(): Keypair {
  const rawKey = process.env.DEVNET_PRIVATE_KEY;
  if (!rawKey) throw new Error('DEVNET_PRIVATE_KEY environment variable is required');
  const parsed = JSON.parse(rawKey) as number[];
  return Keypair.fromSecretKey(new Uint8Array(parsed));
}

function currentSolPriceUsd(): number {
  const raw = Number(process.env.SOL_PRICE_USD ?? '150');
  return Number.isFinite(raw) && raw > 0 ? raw : 150;
}

function computeMinPremiumLamports(swapSizeUsdCents: number, premiumBps: number, solPriceUsd: number): number {
  const notionalUsd = swapSizeUsdCents / 100;
  const premiumUsd = notionalUsd * (premiumBps / 10_000);
  const lamports = Math.ceil((premiumUsd / solPriceUsd) * anchor.web3.LAMPORTS_PER_SOL);
  return Math.max(1, lamports);
}

export class KestrelClient {
  private readonly wallet: anchor.Wallet;
  private readonly connection: Connection;
  private readonly provider: anchor.AnchorProvider;
  private readonly program: anchor.Program;

  constructor() {
    const keypair = loadEnvKeypair();
    this.wallet = new anchor.Wallet(keypair);
    this.connection = new Connection(DEVNET_RPC, 'confirmed');
    this.provider = new anchor.AnchorProvider(this.connection, this.wallet, { commitment: 'confirmed' });
    this.program = new anchor.Program(IDL, this.provider) as anchor.Program;
  }

  get walletPublicKey(): PublicKey { return this.wallet.publicKey; }
  providerForTest(): anchor.AnchorProvider { return this.provider; }
  findVaultPdaForTest(): PublicKey { return this.findVaultPda(); }
  findPolicyPdaForTest(buyer: PublicKey): PublicKey { return this.findPolicyPda(buyer); }

  getMarketState(): MarketQuote {
    return {
      regime: 'CALM', currentBreachRate: 0.029, premiumBps: 20,
      explanation: 'Default public devnet market state', vaultOpen: true,
      coveredBps: 75, liabilityCapBps: 100, capitalGamma: 0.06,
    };
  }

  async initialize(): Promise<string> {
    const tx = await this.program.methods.initialize().accounts({
      vault: this.findVaultPda(), authority: this.wallet.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
    }).transaction();
    return this.provider.sendAndConfirm(tx, [], { commitment: 'confirmed' });
  }

  async issuePolicy(params: IssuePolicyParams): Promise<IssuePolicyResult> {
    const market = this.getMarketState();
    if (market.regime === 'HALTED') {
      throw new Error(`[Kestrel] Vault halted — circuit breaker active. Current breach rate: ${(market.currentBreachRate * 100).toFixed(1)}%`);
    }
    if (market.regime === 'ELEVATED') {
      log.warn('[Kestrel] Elevated conditions — premium is 28 bps', { currentBreachRate: market.currentBreachRate });
    }
    const minPremium = computeMinPremiumLamports(params.swapSizeUsdCents, market.premiumBps, currentSolPriceUsd());
    if (params.premiumLamports < minPremium) {
      throw new Error(`[Kestrel] Premium too low. Required: ${minPremium} lamports (${market.premiumBps}bps) Provided: ${params.premiumLamports} lamports`);
    }
    const buyer = params.buyer ?? this.wallet.publicKey;
    const policyPda = this.findPolicyPda(buyer);
    const tx = await this.program.methods.issuePolicy(
      new BN(params.sequenceNumber), params.guaranteedSlippageBps, new BN(params.swapSizeUsdCents), params.direction, new BN(params.premiumLamports),
    ).accounts({
      vault: this.findVaultPda(), policy: policyPda, buyer, systemProgram: anchor.web3.SystemProgram.programId,
    }).transaction();
    const sig = await this.provider.sendAndConfirm(tx, params.buyerKeypair ? [params.buyerKeypair] : [], { commitment: 'confirmed' });
    log.signal(`[Kestrel] Policy issued: ${policyPda.toBase58()} premium=${params.premiumLamports} lamports regime=${market.regime} premium_bps=${market.premiumBps}`);
    return { signature: sig, policyAddress: policyPda, regime: market.regime, premiumBps: market.premiumBps };
  }

  async settlePolicy(params: SettlePolicyParams): Promise<string> {
    const tx = await this.program.methods.settlePolicy(params.actualSlippageBps, new BN(params.payoutLamports ?? 0)).accounts({
      vault: this.findVaultPda(), policy: params.policyAddress, buyer: params.buyerPublicKey, systemProgram: anchor.web3.SystemProgram.programId,
    }).transaction();
    const sig = await this.provider.sendAndConfirm(tx, params.buyerKeypair ? [params.buyerKeypair] : [], { commitment: 'confirmed' });
    log.signal(`[Kestrel] Policy settled: ${params.policyAddress.toBase58()} actual=${params.actualSlippageBps}bps`);
    return sig;
  }

  async expirePolicy(policyAddress: PublicKey): Promise<string> {
    const tx = await this.program.methods.expirePolicy().accounts({ vault: this.findVaultPda(), policy: policyAddress }).transaction();
    return this.provider.sendAndConfirm(tx, [], { commitment: 'confirmed' });
  }

  async withdrawProfit(amountLamports: number): Promise<string> {
    const tx = await this.program.methods.withdrawProfit(new BN(amountLamports)).accounts({ vault: this.findVaultPda(), authority: this.wallet.publicKey, systemProgram: anchor.web3.SystemProgram.programId }).transaction();
    const sig = await this.provider.sendAndConfirm(tx, [], { commitment: 'confirmed' });
    log.signal(`[Kestrel] Withdrew ${amountLamports} lamports to authority wallet`);
    return sig;
  }

  async getVault(): Promise<GuaranteeVault | null> {
    const accountInfo = await this.connection.getAccountInfo(this.findVaultPda(), 'confirmed');
    if (!accountInfo || accountInfo.data.length < 65) return null;
    const data = accountInfo.data;
    return {
      authority: new PublicKey(data.subarray(8, 40)),
      total_premiums_collected: new BN(data.readBigUInt64LE(40).toString()),
      total_payouts: new BN(data.readBigUInt64LE(48).toString()),
      total_active_exposure: new BN(data.readBigUInt64LE(56).toString()),
      bump: data.readUInt8(64),
    };
  }

  async getPolicy(policyAddress: PublicKey): Promise<GuaranteePolicy | null> {
    const accountInfo = await this.connection.getAccountInfo(policyAddress, 'confirmed');
    if (!accountInfo || accountInfo.data.length < 79) return null;
    const data = accountInfo.data;
    return {
      buyer: new PublicKey(data.subarray(8, 40)),
      premium_paid_lamports: new BN(data.readBigUInt64LE(40).toString()),
      guaranteed_slippage_bps: data.readInt16LE(48),
      swap_size_usd_cents: new BN(data.readBigUInt64LE(50).toString()),
      direction: data.readUInt8(58),
      issued_at: new BN(data.readBigInt64LE(59).toString()),
      expires_at: new BN(data.readBigInt64LE(67).toString()),
      actual_slippage_bps: data.readInt16LE(75),
      status: data.readUInt8(77),
      sequence_number: new BN(data.readBigUInt64LE(78).toString()),
      bump: data.readUInt8(86),
    };
  }

  async getBalance(pubkey: PublicKey): Promise<number> { return this.connection.getBalance(pubkey); }
  async getVaultBalance(): Promise<number> { return this.connection.getBalance(this.findVaultPda()); }
  async fundAccount(pubkey: PublicKey, lamports: number): Promise<string> {
    const tx = new anchor.web3.Transaction().add(anchor.web3.SystemProgram.transfer({ fromPubkey: this.wallet.publicKey, toPubkey: pubkey, lamports }));
    return this.provider.sendAndConfirm(tx, [], { commitment: 'confirmed' });
  }
  async getPolicyRentExemptMinimum(): Promise<number> { return this.connection.getMinimumBalanceForRentExemption(112); }
  async getWalletRentExemptMinimum(): Promise<number> { return 0; }
  computePayout(params: { actualSlippageBps: number; guaranteedSlippageBps: number; swapSizeUsd: number; solPriceUsd: number; premiumLamports?: number }): number {
    const excessBps = Math.max(0, params.actualSlippageBps - params.guaranteedSlippageBps);
    const payoutUsd = (excessBps / 10_000) * params.swapSizeUsd;
    return Math.ceil((payoutUsd / params.solPriceUsd) * 1e9);
  }
  statusLabel(status: number): string {
    switch (status) {
      case STATUS_ACTIVE: return 'active';
      case STATUS_SETTLED_OK: return 'settled_ok';
      case STATUS_SETTLED_CLAIM: return 'settled_claim';
      case STATUS_EXPIRED: return 'expired';
      default: return `unknown(${status})`;
    }
  }
  private findVaultPda(): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync([Buffer.from(VAULT_SEEDS[0])], this.program.programId);
    return pda;
  }
  private findPolicyPda(buyer: PublicKey): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync([Buffer.from(POLICY_SEEDS[0]), buyer.toBuffer()], this.program.programId);
    return pda;
  }
}

export const kestrelClient = new KestrelClient();
export default KestrelClient;
