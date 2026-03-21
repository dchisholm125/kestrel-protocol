import * as anchor from '@coral-xyz/anchor';
import BN from 'bn.js';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import type { KestrelMarketState, MarketRegime } from './types.js';

const VAULT_SEED = 'vault';
const POLICY_SEED = 'policy';

export const DEFAULT_KESTREL_PROGRAM_ID = '3TaXEUn24hw4SncGP9aFskwSqsbhaZod14QEX2akLFxg';

const KESTREL_IDL_TEMPLATE: anchor.Idl = {
  address: DEFAULT_KESTREL_PROGRAM_ID,
  metadata: { name: 'kestrel', version: '0.1.0', spec: '0.1.0' },
  instructions: [
    {
      name: 'issue_policy',
      discriminator: [126, 159, 34, 92, 118, 55, 15, 196],
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
      name: 'settle_policy',
      discriminator: [180, 234, 21, 174, 50, 214, 91, 113],
      accounts: [
        { name: 'vault', writable: true },
        { name: 'policy', writable: true },
        { name: 'buyer', writable: true, signer: true },
        { name: 'settler', writable: true, signer: true },
        { name: 'systemProgram' },
      ],
      args: [
        { name: 'actual_slippage_bps', type: 'i16' },
        { name: 'payout_lamports', type: 'u64' },
      ],
    },
  ],
  types: [],
};

export interface IssuePolicyParams {
  guaranteedSlippageBps: number;
  swapSizeUsdCents: number;
  direction: number;
  premiumLamports: number;
  sequenceNumber: number;
  solPriceUsd: number;
  market: KestrelMarketState;
  buyer?: PublicKey;
  buyerKeypair?: Keypair;
}

export interface IssuePolicyResult {
  signature: string;
  policyAddress: PublicKey;
  regime: MarketRegime;
  premiumBps: number;
}

export interface SettlePolicyParams {
  policyAddress: PublicKey;
  actualSlippageBps: number;
  buyerPublicKey: PublicKey;
  buyerKeypair?: Keypair;
  payoutLamports?: number;
}

function computeMinPremiumLamports(
  swapSizeUsdCents: number,
  premiumBps: number,
  solPriceUsd: number,
): number {
  const notionalUsd = swapSizeUsdCents / 100;
  const premiumUsd = notionalUsd * (premiumBps / 10_000);
  const lamports = Math.ceil((premiumUsd / solPriceUsd) * anchor.web3.LAMPORTS_PER_SOL);
  return Math.max(1, lamports);
}

function pushUniqueSigner(signers: Keypair[], signer: Keypair | undefined, providerKey: PublicKey): void {
  if (!signer || signer.publicKey.equals(providerKey)) {
    return;
  }
  if (!signers.some((existing) => existing.publicKey.equals(signer.publicKey))) {
    signers.push(signer);
  }
}

export class KestrelProgramClient {
  private readonly provider: anchor.AnchorProvider;
  private readonly program: anchor.Program;
  private readonly providerKey: PublicKey;

  constructor(
    private readonly connection: Connection,
    wallet: Keypair,
    private readonly programId: PublicKey,
  ) {
    const anchorWallet = new anchor.Wallet(wallet);
    const idl: anchor.Idl = {
      ...KESTREL_IDL_TEMPLATE,
      address: programId.toBase58(),
    };

    this.provider = new anchor.AnchorProvider(connection, anchorWallet, { commitment: 'confirmed' });
    this.program = new anchor.Program(idl, this.provider) as anchor.Program;
    this.providerKey = anchorWallet.publicKey;
  }

  findPolicyPda(buyer: PublicKey): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from(POLICY_SEED), buyer.toBuffer()],
      this.programId,
    );
    return pda;
  }

  async issuePolicy(params: IssuePolicyParams): Promise<IssuePolicyResult> {
    if (!params.market.vaultOpen || params.market.regime === 'HALTED') {
      throw new Error('Kestrel vault is not open for new protection policies');
    }
    if (params.guaranteedSlippageBps <= 0 || params.guaranteedSlippageBps > 500) {
      throw new Error('guaranteedSlippageBps must be between 1 and 500');
    }

    const minPremiumLamports = computeMinPremiumLamports(
      params.swapSizeUsdCents,
      params.market.premiumBps,
      params.solPriceUsd,
    );
    if (params.premiumLamports < minPremiumLamports) {
      throw new Error(
        `Premium too low. Required ${minPremiumLamports} lamports at ${params.market.premiumBps}bps, got ${params.premiumLamports}`,
      );
    }

    const buyer = params.buyer ?? this.providerKey;
    const policyAddress = this.findPolicyPda(buyer);
    const existingPolicy = await this.connection.getAccountInfo(policyAddress, 'confirmed');
    if (existingPolicy) {
      throw new Error(
        `Current Kestrel program derives one policy PDA per buyer (${buyer.toBase58()}). Use a fresh buyer wallet until policy account rotation is added.`,
      );
    }

    const transaction = await this.program.methods.issuePolicy(
      new BN(params.sequenceNumber),
      params.guaranteedSlippageBps,
      new BN(params.swapSizeUsdCents),
      params.direction,
      new BN(params.premiumLamports),
    ).accounts({
      vault: this.findVaultPda(),
      policy: policyAddress,
      buyer,
      systemProgram: anchor.web3.SystemProgram.programId,
    }).transaction();

    const signers: Keypair[] = [];
    pushUniqueSigner(signers, params.buyerKeypair, this.providerKey);

    const signature = await this.provider.sendAndConfirm(transaction, signers, {
      commitment: 'confirmed',
    });

    return {
      signature,
      policyAddress,
      regime: params.market.regime,
      premiumBps: params.market.premiumBps,
    };
  }

  async settlePolicy(params: SettlePolicyParams, settlerKeypair?: Keypair): Promise<string> {
    const settler = settlerKeypair?.publicKey ?? this.providerKey;
    const signers: Keypair[] = [];

    pushUniqueSigner(signers, params.buyerKeypair, this.providerKey);
    pushUniqueSigner(signers, settlerKeypair, this.providerKey);

    const transaction = await this.program.methods.settlePolicy(
      params.actualSlippageBps,
      new BN(params.payoutLamports ?? 0),
    ).accounts({
      vault: this.findVaultPda(),
      policy: params.policyAddress,
      buyer: params.buyerPublicKey,
      settler,
      systemProgram: anchor.web3.SystemProgram.programId,
    }).transaction();

    return this.provider.sendAndConfirm(transaction, signers, {
      commitment: 'confirmed',
    });
  }

  private findVaultPda(): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from(VAULT_SEED)],
      this.programId,
    );
    return pda;
  }
}
