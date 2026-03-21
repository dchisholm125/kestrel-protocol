use anchor_lang::{prelude::*, system_program};

declare_id!("3TaXEUn24hw4SncGP9aFskwSqsbhaZod14QEX2akLFxg");

#[error_code]
pub enum ErrorCode {
    #[msg("Policy has already been settled")]
    PolicyAlreadySettled,
    #[msg("Policy has already expired")]
    PolicyExpired,
    #[msg("Policy has not yet expired")]
    PolicyNotExpired,
    #[msg("Only the vault authority can settle policies")]
    UnauthorizedSettler,
    #[msg("Guaranteed slippage bps must be between 1 and 500")]
    InvalidSlippageBps,
    #[msg("Vault has insufficient lamports to pay this claim")]
    InsufficientVaultBalance,
    #[msg("Vault has insufficient free reserve for withdrawal")]
    InsufficientFreeReserve,
    #[msg("Vault has insufficient capacity for this policy")]
    InsufficientVaultCapacity,
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

#[account]
pub struct GuaranteeVault {
    pub authority: Pubkey,
    pub settler_authority: Pubkey,
    pub total_premiums_collected: u64,
    pub total_payouts: u64,
    pub total_active_exposure: u64,
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

impl GuaranteePolicy {
    const SEED_PREFIX: &'static str = "policy";
    const SPACE: usize = 8 + std::mem::size_of::<GuaranteePolicy>();
}

impl GuaranteeVault {
    const SEED_PREFIX: &'static str = "vault";
    const SPACE: usize = 8 + std::mem::size_of::<GuaranteeVault>();
}

#[derive(Accounts)]
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

#[derive(Accounts)]
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
        seeds = [GuaranteePolicy::SEED_PREFIX.as_bytes(), buyer.key().as_ref()],
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
        seeds = [GuaranteePolicy::SEED_PREFIX.as_bytes(), policy.buyer.as_ref()],
        bump = policy.bump
    )]
    pub policy: Account<'info, GuaranteePolicy>,
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(mut)]
    pub settler: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateSettler<'info> {
    #[account(
        mut,
        seeds = [GuaranteeVault::SEED_PREFIX.as_bytes()],
        bump = vault.bump
    )]
    pub vault: Account<'info, GuaranteeVault>,
    pub authority: Signer<'info>,
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
        seeds = [GuaranteePolicy::SEED_PREFIX.as_bytes(), policy.buyer.as_ref()],
        bump = policy.bump
    )]
    pub policy: Account<'info, GuaranteePolicy>,
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
    ) -> Result<()> {
        require!(
            guaranteed_slippage_bps > 0 && guaranteed_slippage_bps <= 500,
            ErrorCode::InvalidSlippageBps
        );

        let vault_balance = ctx.accounts.vault.to_account_info().lamports();
        let max_allowed_exposure = vault_balance
            .checked_mul(MAX_EXPOSURE_BPS)
            .unwrap()
            .checked_div(10_000)
            .unwrap();
        let new_exposure = ctx.accounts.vault
            .total_active_exposure
            .checked_add(premium_lamports)
            .unwrap();
        require!(
            new_exposure <= max_allowed_exposure,
            ErrorCode::InsufficientVaultCapacity
        );

        let clock = Clock::get()?;
        let issued_at = clock.unix_timestamp;

        let policy = &mut ctx.accounts.policy;
        policy.buyer = ctx.accounts.buyer.key();
        policy.premium_paid_lamports = premium_lamports;
        policy.guaranteed_slippage_bps = guaranteed_slippage_bps;
        policy.swap_size_usd_cents = swap_size_usd_cents;
        policy.direction = direction;
        policy.issued_at = issued_at;
        policy.expires_at = issued_at.saturating_add(2);
        policy.actual_slippage_bps = 0;
        policy.status = STATUS_ACTIVE;
        policy.sequence_number = sequence_number;
        policy.bump = ctx.bumps.policy;

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
        actual_slippage_bps: i16,
        payout_lamports: u64,
    ) -> Result<()> {
        let policy = &mut ctx.accounts.policy;
        let vault = &mut ctx.accounts.vault;

        require!(
            ctx.accounts.settler.key() == vault.settler_authority,
            ErrorCode::UnauthorizedSettler
        );

        let clock = Clock::get()?;
        let now = clock.unix_timestamp;

        require!(
            policy.status == STATUS_ACTIVE,
            ErrorCode::PolicyAlreadySettled
        );
        require!(
            now <= policy.expires_at.saturating_add(10),
            ErrorCode::PolicyExpired
        );

        let claimed =
            actual_slippage_bps.unsigned_abs() > policy.guaranteed_slippage_bps.unsigned_abs();

        if claimed {
            let payout = payout_lamports;
            policy.status = STATUS_SETTLED_CLAIM;
            vault.total_payouts = vault.total_payouts.saturating_add(payout);
            vault.total_active_exposure = vault
                .total_active_exposure
                .saturating_sub(policy.premium_paid_lamports);

            let vault_info = vault.to_account_info();
            let buyer_info = ctx.accounts.buyer.to_account_info();
            require!(
                **vault_info.lamports.borrow() >= payout,
                ErrorCode::InsufficientVaultBalance
            );

            **vault_info.try_borrow_mut_lamports()? -= payout;
            **buyer_info.try_borrow_mut_lamports()? += payout;
        } else {
            policy.status = STATUS_SETTLED_OK;
            vault.total_active_exposure = vault
                .total_active_exposure
                .saturating_sub(policy.premium_paid_lamports);
        }

        policy.actual_slippage_bps = actual_slippage_bps;

        emit!(PolicySettled {
            policy: ctx.accounts.policy.key(),
            actual_bps: actual_slippage_bps,
            claimed,
        });

        Ok(())
    }

    pub fn expire_policy(ctx: Context<ExpirePolicy>) -> Result<()> {
        let policy = &mut ctx.accounts.policy;

        let clock = Clock::get()?;
        let now = clock.unix_timestamp;

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

    pub fn update_settler(ctx: Context<UpdateSettler>, new_settler: Pubkey) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(
            ctx.accounts.authority.key() == vault.authority,
            ErrorCode::UnauthorizedSettler
        );

        vault.settler_authority = new_settler;

        emit!(SettlerUpdated {
            new_settler,
        });

        Ok(())
    }
}
