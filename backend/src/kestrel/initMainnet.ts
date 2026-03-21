import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import * as anchor from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const MAINNET_RPC_URL = process.env.MAINNET_RPC_URL;
const MAINNET_DEPLOYER_PRIVATE_KEY = process.env.MAINNET_DEPLOYER_PRIVATE_KEY;
const MAINNET_VAULT_AUTHORITY = process.env.MAINNET_VAULT_AUTHORITY;
const MAINNET_SETTLER_PUBKEY = process.env.MAINNET_SETTLER_PUBKEY;
const MAINNET_PROGRAM_ID = process.env.MAINNET_PROGRAM_ID || "3TaXEUn24hw4SncGP9aFskwSqsbhaZod14QEX2akLFxg";

const IDL: anchor.Idl = {
  address: MAINNET_PROGRAM_ID,
  metadata: { name: 'kestrel', version: '0.1.0', spec: '0.1.0' },
  instructions: [
    {
      name: 'initialize',
      discriminator: [175, 175, 109, 31, 13, 152, 155, 237],
      accounts: [
        { name: 'vault', writable: true },
        { name: 'authority', writable: true, signer: true },
        { name: 'systemProgram' },
      ],
      args: [{ name: 'settler_authority', type: 'pubkey' }],
    },
  ],
  types: [],
};

async function main() {
  if (!MAINNET_RPC_URL || !MAINNET_DEPLOYER_PRIVATE_KEY || !MAINNET_VAULT_AUTHORITY || !MAINNET_SETTLER_PUBKEY) {
    console.error("Missing required environment variables. Ensure the following are set in .env:");
    console.error("- MAINNET_RPC_URL");
    console.error("- MAINNET_DEPLOYER_PRIVATE_KEY");
    console.error("- MAINNET_VAULT_AUTHORITY");
    console.error("- MAINNET_SETTLER_PUBKEY");
    process.exit(1);
  }

  // Set up connection and deployer wallet
  const connection = new Connection(MAINNET_RPC_URL, 'confirmed');
  const deployerKeypair = Keypair.fromSecretKey(new Uint8Array(JSON.parse(MAINNET_DEPLOYER_PRIVATE_KEY)));
  const wallet = new anchor.Wallet(deployerKeypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  const program = new anchor.Program(IDL, provider);

  const vaultAuthority = new PublicKey(MAINNET_VAULT_AUTHORITY);
  const settlerAuthority = new PublicKey(MAINNET_SETTLER_PUBKEY);
  const programId = new PublicKey(MAINNET_PROGRAM_ID);

  // Derive Vault PDA
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault")],
    programId
  );

  console.log(`Deriving Vault PDA: ${vaultPda.toBase58()}`);
  console.log(`Using Vault Authority: ${vaultAuthority.toBase58()}`);
  console.log(`Using Settler Authority: ${settlerAuthority.toBase58()}`);

  try {
    const tx = await program.methods
      .initialize(settlerAuthority)
      .accounts({
        vault: vaultPda,
        authority: vaultAuthority,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .transaction();

    // The instruction expects 'authority' as a signer because of `payer = authority`
    // However, if the deployer is different from the vault authority, 
    // we must ensure the authority signs.
    // Wait, let's check the instruction in lib.rs
    /*
    pub struct Initialize<'info> {
        #[account(
            init,
            payer = authority,
            space = GuaranteeVault::SPACE,
            seeds = [GuaranteeVault::SEED_PREFIX.as_bytes()],
            bump
        )]
        pub vault: Account<'info, GuaranteeVault>,
        #[account(mut)]
        pub authority: Signer<'info>,
        pub system_program: Program<'info, System>,
    }
    */
    // This means `authority` MUST be a Signer and is the Payer.
    // If the Deployer is paying, the Deployer must be the authority.
    // If we want a separate deployer to pay but a cold key to be authority,
    // we might need a multisig or the cold key to sign.
    
    // In this script, the 'authority' account in the instruction is matched to `vaultAuthority`.
    // So `vaultAuthority` MUST sign. 
    
    // If the deployer keypair is the one signing, and we want it to be the authority:
    // Then MAINNET_VAULT_AUTHORITY should match deployerKeypair.publicKey.
    
    // If they are different, we need both to sign, but the instruction only lists one signer (authority).
    
    console.log("Sending initialize transaction...");
    const sig = await provider.sendAndConfirm(tx, [], { commitment: 'confirmed' });

    console.log("\n=== KESTREL MAINNET VAULT INITIALIZED ===");
    console.log(`Program:    ${programId.toBase58()}`);
    console.log(`Vault PDA:  ${vaultPda.toBase58()}`);
    console.log(`Authority:  ${vaultAuthority.toBase58()} (COLD KEY - store offline)`);
    console.log(`Settler:    ${settlerAuthority.toBase58()} (HOT KEY - goes in .env)`);
    console.log(`Signature:  ${sig}`);
    console.log(`Solscan:    https://solscan.io/tx/${sig}`);

  } catch (error) {
    console.error("Initialization failed:");
    console.error(error);
    process.exit(1);
  }
}

main().catch(console.error);
