# Kestrel Protocol Architecture

This document describes the current Kestrel architecture direction:

> **transaction-level execution protection for Solana swaps, backed by explicit vault accounting and policy settlement logic**

The intended long-term target remains a fully on-chain atomic underwriting model, but this document is written to match the protocol as it actually behaves today on devnet.

---

## 1. System thesis

Kestrel is a **real-time execution-risk pricing engine** with an insurance-style balance sheet.

At the implementation layer, that means:
- policies are explicit and bounded
- premiums and payouts are recorded
- active exposure is tracked while policies are live
- claim settlement can transfer explicit payout amounts
- underwriting is constrained by solvency checks
- withdrawal of profit is separated from active exposure and reserve floor

At the product layer, that means:
- developers should think in execution guarantees, not claim paperwork
- users should get bounded economic outcomes, not vague promises
- the protocol should refuse dangerous issuance instead of pretending to be always open

---

## 2. Architectural goal

The architecture aims to achieve all of the following:

- **bounded risk**: every policy has explicit economic meaning
- **full reserve discipline**: active exposure is tracked and capacity is enforced
- **anti-spoofing**: protection must exist before settlement
- **low integration friction**: Kestrel should feel like a transaction add-on
- **operational sanity**: authorities, vaults, and program IDs must be traceable and stable

---

## 3. Core protocol model

### 3.1 What Kestrel sells

Kestrel sells **single-transaction execution protection**.

A policy covers one protected trade and can resolve in one of three ways:
- settled with no claim
- settled with claim payout
- expired

### 3.2 Product abstraction

The best product abstraction is still:

> **maximum acceptable execution outcome**

Internally, Kestrel manages:
- premium
- covered slippage threshold
- payout amount
- active exposure
- expiry
- vault accounting

### 3.3 Current execution model

The ideal long-term model is fully atomic protected execution.

The current tested devnet implementation proves the protocol mechanics around:
- policy issuance
- premium collection
- settlement
- payout transfer
- expiry
- reserve/accounting updates

That means the architecture is now more than conceptual scaffolding.
It has working accounting and settlement behavior behind it.

---

## 4. Core accounts

## 4.1 GuaranteeVault

The vault is the protocol balance-sheet account.

It now tracks at least:
- `authority`
- `total_premiums_collected`
- `total_payouts`
- `total_active_exposure`
- `bump`

### Meaning of `total_active_exposure`
This is the current live exposure still tied up in active policies.
It increases on issuance and decreases when a policy is:
- settled with no claim
- settled with a claim
- expired

This is critical because it allows the protocol to reason about:
- free reserve
- capacity
- profit withdrawal safety

## 4.2 GuaranteePolicy

A policy tracks:
- buyer
- premium paid
- guaranteed slippage threshold
- swap size in USD cents
- direction
- issue time
- expiry time
- actual slippage
- status
- sequence number
- bump

Status values currently correspond to:
- active
- settled_ok
- settled_claim
- expired

---

## 5. Core instructions

## 5.1 `initialize`
Creates the vault PDA and sets:
- authority
- premium/payout counters
- active exposure = 0

## 5.2 `issue_policy`
Creates a policy, records issue state, and transfers premium into the vault.

Current important properties:
- premium is actually collected
- active exposure increases
- on-chain solvency/capacity enforcement exists

### On-chain solvency enforcement
The contract now enforces issuance capacity directly in `issue_policy`.
That matters because client-side checks alone are not sufficient; a direct caller could otherwise bypass them.

The current implementation uses a protocol constant-based exposure cap rather than a configurable per-vault `max_exposure_bps` field.
That keeps layout churn down while still enforcing a real ceiling on-chain.

## 5.3 `settle_policy`
Settles a live policy with:
- actual slippage
- explicit payout amount

Current important properties:
- happy-path settlement works
- claim-path settlement works
- claim-path transfer now uses direct lamport mutation from vault PDA
- payouts are no longer just premium refund by default; the client/test path now supplies explicit payout amounts
- active exposure is reduced on settlement

## 5.4 `expire_policy`
Expires a still-active policy after the time window and reduces active exposure.

This is important because it proves capacity can be released without a settlement path.

## 5.5 `withdraw_profit`
Allows the authority wallet to withdraw free profit from the vault.

Current intended validation:
- caller must be vault authority
- withdrawal must not violate reserve floor
- withdrawal must not consume active exposure

This instruction exists to separate:
- protocol profit
from
- capital still required to support active policies

---

## 6. Accounting model

Kestrel accounting now has four distinct moving parts:

### 6.1 Premiums collected
Increase when policies are issued.

### 6.2 Payouts made
Increase when claim-path settlement pays out.

### 6.3 Active exposure
Increases on issuance.
Decreases on settlement or expiry.

### 6.4 Free reserve
Conceptually:

`free_reserve = vault_balance - total_active_exposure - reserve_floor`

This is the number that matters for safe withdrawal and future capacity.

---

## 7. Regime-aware pricing

The current test/client environment already supports a live market-state abstraction:
- `CALM`
- `ELEVATED`
- `HALTED`

This is currently driven from recent slippage observations rather than full on-chain config accounts.

Even though the long-term architecture may evolve, the important point is that Kestrel no longer assumes the market is always homogeneous.

That is an important architectural truth, not just a pricing convenience.

---

## 8. Settlement economics

The desired payout model remains:

`payout = min(limit, max(0, realized_loss - covered_threshold))`

In the current dev/test implementation, explicit payout amounts are passed into settlement and then applied on-chain.

That means:
- economic correctness now depends on both the payout calculation path and the on-chain transfer/accounting path
- and both of those have been exercised successfully in devnet tests

This is a meaningful step toward a production underwriting engine.

---

## 9. Capacity enforcement

The architecture now recognizes a key truth:

> **client-side solvency checks are not enough**

A direct caller can bypass the TypeScript client entirely.
So issuance capacity must be enforced on-chain.

That is now part of `issue_policy`.

### Current state
Capacity enforcement exists on-chain, but the stress suite shows that the exact cap calibration still needs tuning to produce fast, obvious ceiling behavior in small synthetic tests.

That is now a calibration problem, not an absence-of-check problem.

---

## 10. Withdrawal design

`withdraw_profit` should not be thought of as “move whatever SOL is sitting in the vault.”
It should be thought of as:

> **withdraw only the capital that is clearly free after active exposure and reserve floor are respected**

This is why the protocol now needs clear separation between:
- active exposure
- reserve floor
- withdrawable profit

This is also why wallet/authority recordkeeping becomes a real operational concern before mainnet.

---

## 11. Devnet-proven behavior

The current devnet harnesses now prove:
- vault init works
- policy issuance works
- happy-path settlement works
- claim-path settlement works
- payout accuracy checks work
- expiry works
- double settlement rejection works
- concurrent settlement behavior works
- stress harness runs to completion

This does **not** mean the protocol is mainnet-ready.
It means the implementation now has enough substance to justify serious deployment planning.

---

## 12. Honest limitations

### 12.1 Jupiter/devnet reliability
Real swap execution on devnet may still fall back to simulated paths depending on infra availability.
This should be documented honestly rather than hidden.

### 12.2 Capacity calibration still needs tuning
The stress suite can now probe capacity behavior, but the exact ceiling behavior is still influenced by vault size and chosen test notionals.

### 12.3 Layout changes are operationally expensive
Repeated changes to vault/account layout create real deployment friction because stale PDAs remain on devnet/mainnet.
That is now one of the main reasons to reduce contract churn before mainnet.

---

## 13. Architectural summary

Kestrel should now be understood as:

- a policy-issuing execution protection protocol
- with explicit vault accounting
- with real payout settlement behavior
- with active exposure tracking
- with on-chain solvency enforcement
- and with an emerging separation between protocol logic and treasury operations

That is much closer to real underwriting infrastructure than a toy demo.

---

## 14. Near-term priorities

1. validate withdrawal behavior on devnet
2. validate reserve-floor rejection
3. validate concurrent collection + real tests where relevant
4. tighten mainnet deployment discipline
5. stop casual program/account layout churn before first mainnet-beta launch

---

## 15. Related docs

- [README.md](./README.md)
- [PRICING_MODEL.md](./PRICING_MODEL.md)
- [MAINNET_DEPLOYMENT.md](./MAINNET_DEPLOYMENT.md)
