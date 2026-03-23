use anchor_lang::{prelude::*, system_program};
use std::str::FromStr;

const MAX_PRICE_AGE_SECONDS: i64 = 120;

declare_id!("46PW8Yrw8KNtgLcmBEW9GQPjaYQJUxJSxM8KPBMJ5RMS");

#[error_code]
pub enum ErrorCode {
    #[msg("Policy already settled")]
    PolicyAlreadySettled,
    #[msg("Policy expired")]
    PolicyExpired,
    #[msg("Policy not yet expired")]
    PolicyNotExpired,
    #[msg("Unauthorized settler")]
    UnauthorizedSettler,
    #[msg("Invalid slippage bps")]
    InvalidSlippageBps,
    #[msg("Insufficient vault balance")]
    InsufficientVaultBalance,
    #[msg("Insufficient free reserve")]
    InsufficientFreeReserve,
    #[msg("Insufficient vault capacity")]
    InsufficientVaultCapacity,
    #[msg("Invalid sequence number")]
    InvalidSequenceNumber,
    #[msg("Buyer mismatch")]
    BuyerMismatch,
    #[msg("Vault already closed")]
    VaultAlreadyClosed,
    #[msg("Unsupported token pair")]
    UnsupportedTokenPair,
    #[msg("Price unavailable")]
    PriceUnavailable,
    #[msg("Price too stale")]
    PriceTooStale,
    #[msg("Overflow")]
    Overflow,
    #[msg("Premium too low")]
    PremiumTooLow,
    #[msg("Vault has active exposure")]
    VaultHasActiveExposure,
}

#[event]
pub struct PolicyIssued {
    pub policy: Pubkey,
    pub buyer: Pubkey,
    pub guaranteed_bps: i16,
    pub size_usd_cents: u64,
}

#[event]
pub struct PolicySettled {
    pub policy: Pubkey,
    pub actual_bps: i16,
    pub claimed: bool,
}

#[event]
pub struct PolicyExpired {
    pub policy: Pubkey,
}

#[event]
pub struct ProfitWithdrawn {
    pub authority: Pubkey,
    pub amount_lamports: u64,
}

#[event]
pub struct SettlerUpdated {
    pub new_settler: Pubkey,
}

#[event]
pub struct VaultClosed {
    pub authority: Pubkey,
    pub lamports_returned: u64,
    pub legacy_active_exposure: u64,
}

#[account]
pub struct GuaranteeVault {
    pub authority: Pubkey,
    pub settler_authority: Pubkey,
    pub total_premiums_collected: u64,
    pub total_payouts: u64,
    pub total_active_exposure: u64,
    pub total_policies_issued: u64,
    pub bump: u8,
}

#[account]
pub struct GuaranteePolicy {
    pub buyer: Pubkey,
    pub premium_paid_lamports: u64,
    pub guaranteed_slippage_bps: i16,
    pub swap_size_usd_cents: u64,
    pub direction: u8,
    pub issued_at: i64,
    pub expires_at: i64,
    pub actual_slippage_bps: i16,
    pub status: u8,
    pub sequence_number: u64,
    pub bump: u8,
}

const STATUS_ACTIVE: u8 = 0;
const STATUS_SETTLED_OK: u8 = 1;
const STATUS_SETTLED_CLAIM: u8 = 2;
const STATUS_EXPIRED: u8 = 3;
const MAX_EXPOSURE_BPS: u64 = 5_000;

pub const TOKEN_PAIR_SOL_USDC: u8 = 0;
pub const PYTH_SOL_USD_MAINNET: &str = "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE";
pub const PYTH_SOL_USD_DEVNET: &str = "J83w4HKfqxwcq3BEMMkPFSppX3gqekLyLJBexebFVkix";
const PYTH_RECEIVER_PROGRAM_ID: &str = "rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ";
const PYTH_PUSH_ORACLE_PROGRAM_ID: &str = "pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT";
// SOL/USD PriceFeedMessage layout (after 8-byte discriminator + 32-byte write_authority):
//   offset 40: verification_level (1 byte, 1 = Full)
//   offset 41..73: feed_id ([u8; 32])
//   offset 73..81: price (i64)
//   offset 81..89: conf (u64)
//   offset 89..93: exponent (i32)
//   offset 93..101: publish_time (i64)
const PYTH_SOL_USD_FEED_ID: [u8; 32] = [
    239, 13, 139, 111, 218, 44, 235, 164, 29, 161, 93, 64, 149, 209, 218, 57, 42, 13, 47, 142,
    208, 198, 199, 188, 15, 76, 250, 200, 194, 128, 181, 109,
];
const PYTH_SOL_USD_SHARD_ID: u16 = 0;

fn expected_pyth_sol_usd_mainnet_feed() -> Pubkey {
    let push_oracle_program_id = Pubkey::from_str(PYTH_PUSH_ORACLE_PROGRAM_ID)
        .expect("valid Pyth push-oracle program id");
    Pubkey::find_program_address(
        &[&PYTH_SOL_USD_SHARD_ID.to_le_bytes(), &PYTH_SOL_USD_FEED_ID],
        &push_oracle_program_id,
    )
    .0
}

impl GuaranteePolicy {
    const SEED_PREFIX: &'static str = "policy";
    const SPACE: usize = 8 + std::mem::size_of::<GuaranteePolicy>();
}

impl GuaranteeVault {
    const SEED_PREFIX: &'static str = "vault";
    const SPACE: usize = 8 + std::mem::size_of::<GuaranteeVault>();
}

fn close_policy_account<'info>(policy_info: &AccountInfo<'info>, destination_info: &AccountInfo<'info>) -> Result<()> {
    let lamports = policy_info.lamports();
    **destination_info.try_borrow_mut_lamports()? += lamports;
    **policy_info.try_borrow_mut_lamports()? = 0;
    policy_info.try_borrow_mut_data()?.fill(0);
    Ok(())
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = payer,
        space = GuaranteeVault::SPACE,
        seeds = [GuaranteeVault::SEED_PREFIX.as_bytes()],
        bump
    )]
    pub vault: Account<'info, GuaranteeVault>,
    /// CHECK: This is the cold key pubkey we're storing
    /// as vault authority. Does not need to sign at init.
    pub authority: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(sequence_number: u64, guaranteed_slippage_bps: i16, swap_size_usd_cents: u64, direction: u8, premium_lamports: u64, token_pair: u8)]
pub struct IssuePolicy<'info> {
    #[account(
        mut,
        seeds = [GuaranteeVault::SEED_PREFIX.as_bytes()],
        bump = vault.bump
    )]
    pub vault: Account<'info, GuaranteeVault>,
    #[account(
        init,
        payer = buyer,
        space = GuaranteePolicy::SPACE,
        seeds = [
            GuaranteePolicy::SEED_PREFIX.as_bytes(),
            buyer.key().as_ref(),
            &sequence_number.to_le_bytes()
        ],
        bump
    )]
    pub policy: Account<'info, GuaranteePolicy>,
    #[account(mut)]
    pub buyer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SettlePolicy<'info> {
    #[account(
        mut,
        seeds = [GuaranteeVault::SEED_PREFIX.as_bytes()],
        bump = vault.bump
    )]
    pub vault: Account<'info, GuaranteeVault>,
    #[account(
        mut,
        seeds = [
            GuaranteePolicy::SEED_PREFIX.as_bytes(),
            policy.buyer.as_ref(),
            &policy.sequence_number.to_le_bytes()
        ],
        bump = policy.bump
    )]
    pub policy: Account<'info, GuaranteePolicy>,
    /// CHECK: This is the buyer account that will receive the payout if claimed
    /// and receive the rent refund when the policy is closed.
    /// We verify it matches policy.buyer in the instruction.
    #[account(mut)]
    pub buyer: UncheckedAccount<'info>,
    #[account(mut)]
    pub settler: Signer<'info>,
    /// CHECK: Pyth SOL/USD push-oracle PriceUpdateV2 account.
    /// Owner is validated against PYTH_RECEIVER_PROGRAM_ID.
    /// Feed ID and staleness are validated in the instruction body.
    pub price_update: AccountInfo<'info>,
    pub clock: Sysvar<'info, Clock>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExpirePolicy<'info> {
    #[account(
        mut,
        seeds = [GuaranteeVault::SEED_PREFIX.as_bytes()],
        bump = vault.bump
    )]
    pub vault: Account<'info, GuaranteeVault>,
    #[account(
        mut,
        seeds = [
            GuaranteePolicy::SEED_PREFIX.as_bytes(),
            policy.buyer.as_ref(),
            &policy.sequence_number.to_le_bytes()
        ],
        bump = policy.bump
    )]
    pub policy: Account<'info, GuaranteePolicy>,
    /// CHECK: Buyer receives rent refund when policy is expired and closed.
    /// Must match policy.buyer.
    #[account(mut)]
    pub buyer: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct WithdrawProfit<'info> {
    #[account(
        mut,
        seeds = [GuaranteeVault::SEED_PREFIX.as_bytes()],
        bump = vault.bump
    )]
    pub vault: Account<'info, GuaranteeVault>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateSettlerAuthority<'info> {
    #[account(
        mut,
        seeds = [GuaranteeVault::SEED_PREFIX.as_bytes()],
        bump = vault.bump,
        has_one = authority @ ErrorCode::UnauthorizedSettler
    )]
    pub vault: Account<'info, GuaranteeVault>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct CloseVault<'info> {
    /// CHECK: We verify authority and handle schema-mismatched bytes manually.
    #[account(mut, seeds = [GuaranteeVault::SEED_PREFIX.as_bytes()], bump)]
    pub vault: UncheckedAccount<'info>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[program]
pub mod kestrel {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, settler_authority: Pubkey) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.authority = ctx.accounts.authority.key();
        vault.settler_authority = settler_authority;
        vault.total_premiums_collected = 0;
        vault.total_payouts = 0;
        vault.total_active_exposure = 0;
        vault.total_policies_issued = 0;
        vault.bump = ctx.bumps.vault;
        Ok(())
    }

    pub fn issue_policy(
        ctx: Context<IssuePolicy>,
        sequence_number: u64,
        guaranteed_slippage_bps: i16,
        swap_size_usd_cents: u64,
        direction: u8,
        premium_lamports: u64,
        token_pair: u8,
    ) -> Result<()> {
        require!(
            token_pair == TOKEN_PAIR_SOL_USDC,
            ErrorCode::UnsupportedTokenPair
        );
        require!(
            guaranteed_slippage_bps > 0 && guaranteed_slippage_bps <= 500,
            ErrorCode::InvalidSlippageBps
        );

        let vault_balance = ctx.accounts.vault.to_account_info().lamports();
        let max_allowed_exposure = vault_balance
            .checked_mul(MAX_EXPOSURE_BPS)
            .ok_or(error!(ErrorCode::Overflow))?
            .checked_div(10_000)
            .ok_or(error!(ErrorCode::Overflow))?;
        let new_exposure = ctx.accounts.vault
            .total_active_exposure
            .checked_add(premium_lamports)
            .ok_or(error!(ErrorCode::Overflow))?;
        require!(
            new_exposure <= max_allowed_exposure,
            ErrorCode::InsufficientVaultCapacity
        );

        let clock = Clock::get()?;
        let issued_at = clock.unix_timestamp;
        let next_sequence = ctx.accounts.vault.total_policies_issued;

        require!(
            sequence_number == next_sequence,
            ErrorCode::InvalidSequenceNumber
        );

        let policy = &mut ctx.accounts.policy;
        policy.buyer = ctx.accounts.buyer.key();
        policy.premium_paid_lamports = premium_lamports;
        policy.guaranteed_slippage_bps = guaranteed_slippage_bps;
        policy.swap_size_usd_cents = swap_size_usd_cents;
        policy.direction = direction;
        policy.issued_at = issued_at;
        policy.expires_at = issued_at.saturating_add(300);
        policy.actual_slippage_bps = 0;
        policy.status = STATUS_ACTIVE;
        policy.sequence_number = sequence_number;
        policy.bump = ctx.bumps.policy;

        ctx.accounts.vault.total_policies_issued = ctx.accounts.vault.total_policies_issued.saturating_add(1);

        if premium_lamports > 0 {
            let vault = &mut ctx.accounts.vault;
            vault.total_premiums_collected = vault
                .total_premiums_collected
                .saturating_add(premium_lamports);
            vault.total_active_exposure = vault
                .total_active_exposure
                .saturating_add(premium_lamports);

            system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    system_program::Transfer {
                        from: ctx.accounts.buyer.to_account_info(),
                        to: ctx.accounts.vault.to_account_info(),
                    },
                ),
                premium_lamports,
            )?;
        }

        emit!(PolicyIssued {
            policy: ctx.accounts.policy.key(),
            buyer: ctx.accounts.buyer.key(),
            guaranteed_bps: guaranteed_slippage_bps,
            size_usd_cents: swap_size_usd_cents,
        });

        Ok(())
    }

    pub fn settle_policy(
        ctx: Context<SettlePolicy>,
        actual_output_usdc_micro: u64,
    ) -> Result<()> {
        let policy = &mut ctx.accounts.policy;
        let vault = &mut ctx.accounts.vault;

        let clock = Clock::get()?;
        let now = clock.unix_timestamp;

        // Verify that the buyer account passed matches the one in the policy
        require!(
            ctx.accounts.buyer.key() == policy.buyer,
            ErrorCode::BuyerMismatch
        );

        // Only the designated settler authority may sign settlement
        require!(
            ctx.accounts.settler.key() == vault.settler_authority,
            ErrorCode::UnauthorizedSettler
        );
        require!(
            policy.status == STATUS_ACTIVE,
            ErrorCode::PolicyAlreadySettled
        );
        require!(
            now <= policy.expires_at.saturating_add(10),
            ErrorCode::PolicyExpired
        );

        // Validate the price update account is a genuine Pyth push-oracle account
        // for the SOL/USD feed, owned by the Pyth Receiver program.
        let pyth_mainnet = expected_pyth_sol_usd_mainnet_feed();
        let pyth_devnet = Pubkey::from_str(PYTH_SOL_USD_DEVNET)
            .map_err(|_| error!(ErrorCode::PriceUnavailable))?;
        require!(
            ctx.accounts.price_update.key() == pyth_mainnet
                || ctx.accounts.price_update.key() == pyth_devnet,
            ErrorCode::PriceUnavailable
        );
        require!(
            ctx.accounts.price_update.owner == &Pubkey::from_str(PYTH_RECEIVER_PROGRAM_ID)
                .map_err(|_| error!(ErrorCode::PriceUnavailable))?,
            ErrorCode::PriceUnavailable
        );

        // Parse PriceUpdateV2 account data (manual layout, no SDK version conflict):
        //   [0..8]   discriminator
        //   [8..40]  write_authority (Pubkey)
        //   [40]     verification_level variant (1 = Full)
        //   [41..73] feed_id ([u8; 32])
        //   [73..81] price (i64, little-endian)
        //   [81..89] conf (u64, little-endian)
        //   [89..93] exponent (i32, little-endian)
        //   [93..101] publish_time (i64, little-endian)
        let data = ctx
            .accounts
            .price_update
            .try_borrow_data()
            .map_err(|_| error!(ErrorCode::PriceUnavailable))?;
        require!(data.len() >= 101, ErrorCode::PriceUnavailable);

        let verification_level = data[40];
        require!(verification_level == 1, ErrorCode::PriceUnavailable);

        let feed_id_bytes: [u8; 32] = data[41..73]
            .try_into()
            .map_err(|_| error!(ErrorCode::PriceUnavailable))?;
        require!(feed_id_bytes == PYTH_SOL_USD_FEED_ID, ErrorCode::PriceUnavailable);

        let price = i64::from_le_bytes(
            data[73..81]
                .try_into()
                .map_err(|_| error!(ErrorCode::PriceUnavailable))?,
        );
        let price_exponent = i32::from_le_bytes(
            data[89..93]
                .try_into()
                .map_err(|_| error!(ErrorCode::PriceUnavailable))?,
        );
        let publish_time = i64::from_le_bytes(
            data[93..101]
                .try_into()
                .map_err(|_| error!(ErrorCode::PriceUnavailable))?,
        );

        let price_age = now
            .checked_sub(publish_time)
            .ok_or(error!(ErrorCode::PriceTooStale))?;
        require!(price_age <= MAX_PRICE_AGE_SECONDS, ErrorCode::PriceTooStale);

        require!(price > 0, ErrorCode::PriceUnavailable);
        // Integer-only price conversion — no f64.
        // sol_price_usd_cents = price * 100 / 10^(-exponent)
        // For SOL/USD exponent is always -8; fast path avoids the general pow.
        let sol_price_usd_cents: u64 = if price_exponent == -8 {
            // price / 10^6  (= price * 100 / 10^8)
            (price as u64)
                .checked_div(1_000_000)
                .ok_or(error!(ErrorCode::PriceUnavailable))?
        } else if price_exponent < 0 {
            // general negative exponent: price * 100 / 10^(-exponent)
            let exp_mag = (-price_exponent) as u32;
            let divisor = 10u64
                .checked_pow(exp_mag.saturating_sub(2))
                .ok_or(error!(ErrorCode::Overflow))?;
            (price as u64)
                .checked_div(divisor)
                .ok_or(error!(ErrorCode::PriceUnavailable))?
        } else {
            // positive exponent (unusual): price * 100 * 10^exponent
            let multiplier = 10u64
                .checked_pow(price_exponent as u32)
                .ok_or(error!(ErrorCode::Overflow))?;
            (price as u64)
                .checked_mul(multiplier)
                .ok_or(error!(ErrorCode::Overflow))?
                .checked_mul(100)
                .ok_or(error!(ErrorCode::Overflow))?
        };
        require!(sol_price_usd_cents > 0, ErrorCode::PriceUnavailable);

        // Enforce minimum premium: at least 1 bps of swap size at current oracle price
        // min_premium_lamports = swap_size_usd_cents * 1e9 / (sol_price_usd_cents * 10_000)
        let min_premium_lamports = policy
            .swap_size_usd_cents
            .checked_mul(1_000_000_000)
            .ok_or(error!(ErrorCode::Overflow))?
            .checked_div(
                sol_price_usd_cents
                    .checked_mul(10_000)
                    .ok_or(error!(ErrorCode::Overflow))?,
            )
            .ok_or(error!(ErrorCode::Overflow))?;
        require!(
            policy.premium_paid_lamports >= min_premium_lamports,
            ErrorCode::PremiumTooLow
        );

        let expected_output_micro = policy
            .swap_size_usd_cents
            .checked_mul(1_000_000)
            .ok_or(error!(ErrorCode::Overflow))?;

        let verified_slippage_bps = if actual_output_usdc_micro >= expected_output_micro {
            0u64
        } else {
            expected_output_micro
                .saturating_sub(actual_output_usdc_micro)
                .checked_mul(10_000)
                .ok_or(error!(ErrorCode::Overflow))?
                .checked_div(expected_output_micro)
                .ok_or(error!(ErrorCode::Overflow))?
        };

        let guaranteed_bps = policy.guaranteed_slippage_bps.unsigned_abs() as u64;

        let payout_lamports = if verified_slippage_bps > guaranteed_bps {
            let excess_bps = verified_slippage_bps - guaranteed_bps;
            let price_denominator = sol_price_usd_cents
                .checked_mul(100)
                .ok_or(error!(ErrorCode::Overflow))?;
            let swap_size_lamports = policy
                .swap_size_usd_cents
                .checked_mul(1_000_000_000)
                .ok_or(error!(ErrorCode::Overflow))?
                .checked_div(price_denominator)
                .ok_or(error!(ErrorCode::Overflow))?;

            excess_bps
                .checked_mul(swap_size_lamports)
                .ok_or(error!(ErrorCode::Overflow))?
                .checked_div(10_000)
                .ok_or(error!(ErrorCode::Overflow))?
        } else {
            0u64
        };

        let claimed = payout_lamports > 0;
        let verified_slippage_i16 = i16::try_from(verified_slippage_bps)
            .map_err(|_| error!(ErrorCode::Overflow))?;

        if claimed {
            policy.status = STATUS_SETTLED_CLAIM;
            vault.total_payouts = vault.total_payouts.saturating_add(payout_lamports);
            vault.total_active_exposure = vault
                .total_active_exposure
                .saturating_sub(policy.premium_paid_lamports);

            let vault_info = vault.to_account_info();
            let buyer_info = ctx.accounts.buyer.to_account_info();

            require!(
                **vault_info.lamports.borrow() >= payout_lamports,
                ErrorCode::InsufficientVaultBalance
            );

            **vault_info.try_borrow_mut_lamports()? -= payout_lamports;
            **buyer_info.try_borrow_mut_lamports()? += payout_lamports;
        } else {
            policy.status = STATUS_SETTLED_OK;
            vault.total_active_exposure = vault
                .total_active_exposure
                .saturating_sub(policy.premium_paid_lamports);
        }

        policy.actual_slippage_bps = verified_slippage_i16;

        emit!(PolicySettled {
            policy: ctx.accounts.policy.key(),
            actual_bps: verified_slippage_i16,
            claimed,
        });

        close_policy_account(
            &ctx.accounts.policy.to_account_info(),
            &ctx.accounts.buyer.to_account_info(),
        )?;

        Ok(())
    }

    pub fn expire_policy(ctx: Context<ExpirePolicy>) -> Result<()> {
        let policy = &mut ctx.accounts.policy;

        let clock = Clock::get()?;
        let now = clock.unix_timestamp;

        require!(
            ctx.accounts.buyer.key() == policy.buyer,
            ErrorCode::BuyerMismatch
        );
        require!(
            now > policy.expires_at.saturating_add(10),
            ErrorCode::PolicyNotExpired
        );
        require!(
            policy.status == STATUS_ACTIVE,
            ErrorCode::PolicyAlreadySettled
        );

        policy.status = STATUS_EXPIRED;
        ctx.accounts.vault.total_active_exposure = ctx.accounts.vault
            .total_active_exposure
            .saturating_sub(policy.premium_paid_lamports);

        emit!(PolicyExpired {
            policy: ctx.accounts.policy.key(),
        });

        close_policy_account(
            &ctx.accounts.policy.to_account_info(),
            &ctx.accounts.buyer.to_account_info(),
        )?;

        Ok(())
    }

    pub fn withdraw_profit(ctx: Context<WithdrawProfit>, amount_lamports: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(
            ctx.accounts.authority.key() == vault.authority,
            ErrorCode::UnauthorizedSettler
        );

        let vault_info = vault.to_account_info();
        let authority_info = ctx.accounts.authority.to_account_info();
        let vault_balance = vault_info.lamports();
        let minimum_reserve = 500_000_000u64;
        let withdrawable = vault_balance
            .saturating_sub(vault.total_active_exposure)
            .saturating_sub(minimum_reserve);

        require!(
            amount_lamports <= withdrawable,
            ErrorCode::InsufficientFreeReserve
        );

        **vault_info.try_borrow_mut_lamports()? -= amount_lamports;
        **authority_info.try_borrow_mut_lamports()? += amount_lamports;

        emit!(ProfitWithdrawn {
            authority: ctx.accounts.authority.key(),
            amount_lamports,
        });

        Ok(())
    }

    pub fn update_settler_authority(ctx: Context<UpdateSettlerAuthority>, new_settler: Pubkey) -> Result<()> {
        ctx.accounts.vault.settler_authority = new_settler;
        emit!(SettlerUpdated { new_settler });
        Ok(())
    }

    pub fn close_vault(ctx: Context<CloseVault>) -> Result<()> {
        let vault_info = ctx.accounts.vault.to_account_info();
        let authority_info = ctx.accounts.authority.to_account_info();

        require!(*vault_info.owner == crate::ID, ErrorCode::VaultAlreadyClosed);
        require!(vault_info.data_len() >= 97, ErrorCode::VaultAlreadyClosed);

        let stored_authority = {
            let vault_data = vault_info.try_borrow_data()?;
            Pubkey::try_from(&vault_data[8..40]).map_err(|_| error!(ErrorCode::UnauthorizedSettler))?
        };

        require!(
            stored_authority == ctx.accounts.authority.key(),
            ErrorCode::UnauthorizedSettler
        );

        let legacy_active_exposure = {
            let vault_data = vault_info.try_borrow_data()?;
            let exposure_bytes: [u8; 8] = vault_data[88..96]
                .try_into()
                .map_err(|_| error!(ErrorCode::VaultAlreadyClosed))?;
            u64::from_le_bytes(exposure_bytes)
        };

        require!(
            legacy_active_exposure == 0,
            ErrorCode::VaultHasActiveExposure
        );

        let lamports_returned = vault_info.lamports();
        **authority_info.try_borrow_mut_lamports()? += lamports_returned;
        **vault_info.try_borrow_mut_lamports()? = 0;
        vault_info.try_borrow_mut_data()?.fill(0);

        emit!(VaultClosed {
            authority: ctx.accounts.authority.key(),
            lamports_returned,
            legacy_active_exposure,
        });

        Ok(())
    }
}
