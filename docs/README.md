# Kestrel Protocol

Atomic execution protection for Solana swaps.

Kestrel is a **real-time execution-risk pricing engine** that sells **fully collateralized, per-transaction slippage protection**.

Instead of asking traders and bot developers to reason about separate slippage limits, insurance premiums, and claim math, Kestrel aims to let them express a single constraint:

> **"Execute this trade only if my economic execution outcome stays inside this bound."**

At the product level, Kestrel should feel like a transaction primitive.
Under the hood, it behaves like a small, conservative microstructure insurer.

---

## The product in one sentence

**Kestrel turns a swap into a protected swap by pricing and settling a bounded slippage guarantee.**

---

## Why this exists

Solana traders face a familiar tradeoff:

- set slippage too tight and the transaction often fails
- set slippage too wide and the transaction can land with ugly execution

Kestrel changes that tradeoff.

A user or bot specifies a maximum acceptable execution outcome. Kestrel either:

- **underwrites the trade** and allows the transaction to proceed with protection, or
- **declines to underwrite** and the protected path does not execute

That means the product is not really a claims workflow first.
It is an **execution constraint with underwriting behind it**.

---

## Core selling points

### 1. Bounded worst-case outcome
Kestrel does not promise perfect fills.
It promises something more honest and useful:

> **if the protected transaction executes, the user’s economic downside is bounded by the agreed policy terms.**

### 2. Better execution flexibility without unbounded slippage risk
Kestrel does not change validator physics.
It does make it easier to tolerate execution variance safely, which can improve practical fill rates relative to very tight unprotected slippage settings.

### 3. Fully collateralized underwriting
Kestrel only issues protection when the vault can safely carry the exposure.

No pretend fractional reserve story.
No vague “insurance” language without accounting behind it.

### 4. Regime-aware pricing
Kestrel pricing is intended to react to current market conditions.
The current dev/test environment already supports:

- `CALM`
- `ELEVATED`
- `HALTED`

so the protocol can widen pricing or stop underwriting under stress instead of pretending the market is always the same.

### 5. Developer-friendly mental model
The long-term DX goal is still:

> **turn this swap into an insured swap with one extra step**

Developers should not need to manually solve:
- slippage tolerance
- payout math
- reserve math
- premium decomposition

---

## What is working today

The current codebase has now proven on devnet that it can:

- initialize a vault
- issue policies
- settle happy-path policies
- settle claim-path policies
- pay explicit excess-slippage payouts
- track premiums, payouts, and active exposure
- reject double settlement
- expire policies
- enforce a live premium floor
- apply regime-aware pricing decisions on the client side
- enforce solvency / capacity checks on-chain during issuance

The stress suite also now runs cleanly end-to-end, with capacity behavior treated as a calibration warning rather than a broken harness.

---

## Current protocol mechanics

At a high level, the tested flow is now:

1. determine live market regime and premium floor
2. issue a policy if underwriting conditions are acceptable
3. collect premium into the vault
4. track active exposure while policy is live
5. settle with either:
   - no claim, or
   - explicit payout amount for excess slippage
6. release active exposure when the policy is settled or expired

The protocol also includes a `withdraw_profit` path with a reserve floor, though this should be treated as treasury/operations plumbing rather than casual user-facing behavior.

---

## Policy model

Each policy is a single-use protection contract.

At minimum, it should answer:
- what transaction is covered?
- what slippage threshold is guaranteed?
- what premium is paid?
- what payout can occur?
- how much exposure does the vault carry while the policy is live?

### Current tested settlement shape

The current claim path now supports explicit payout amounts rather than simply refunding premium.

A practical canonical form is still:

`payout = min(policy_limit, max(0, realized_loss - covered_threshold))`

That is the economic model the protocol should continue to converge toward.

---

## Current architecture direction

This repo is still documented around **Architecture A: fully on-chain atomic underwriting**.

That remains the design target:

- underwriting enforced in the transaction path
- policy creation and transaction behavior tied together
- no post-trade policy purchase
- explicit reserve / exposure accounting

But the current implementation should be understood honestly as:

> **a strong devnet protocol prototype with working issue/settle/accounting flows, not a finished mainnet product.**

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the detailed system design.

---

## Developer experience goals

The ideal future SDK still looks something like:

```ts
const guarantee = await kestrel.getGuarantee({
  inputMint,
  outputMint,
  amount,
  maxTotalCostBps: 80,
  userPublicKey,
});

const protectedTx = await kestrel.attachProtection({
  guarantee,
  swapTransaction,
});
```

Even though the current repo is still lower-level than that, the DX goal should stay the same.

---

## Current strategic identity

Kestrel is best understood as:

- **externally:** a real-time execution protection protocol
- **internally:** a microstructure insurance company
- **technically:** a transaction-level execution guarantee primitive for Solana

That combination is the point.

---

## Design principles

1. **Atomic or nothing** — protection and execution should succeed or fail together where possible.
2. **Bounded liability** — every issued policy must have explicit economic limits.
3. **Fully reserved** — do not sell protection the vault cannot actually carry.
4. **Low cognitive overhead** — users set constraints; Kestrel handles underwriting complexity.
5. **No post-outcome cheating** — protection must exist before outcome is known.
6. **Truthful claims** — Kestrel improves safe execution flexibility, not validator inclusion mechanics.
7. **Operational discipline** — authority wallets, program IDs, vault PDAs, and upgrade paths must be tracked carefully.

---

## Status

Kestrel is now in the phase where:
- the core devnet behavior is real enough to validate
- the remaining work is increasingly about deployment discipline, account management, and mainnet readiness

The most important work ahead is:
- finalizing mainnet deployment process
- validating withdraw / reserve-floor behavior cleanly
- improving or documenting Jupiter/devnet test limitations
- tightening capacity enforcement calibration
- updating docs and ops recordkeeping

---

## Next reading

- [ARCHITECTURE.md](./ARCHITECTURE.md) — current system design and on-chain/accounting model
- [PRICING_MODEL.md](./PRICING_MODEL.md) — pricing logic, calibration, and regime-aware interpretation
- [MAINNET_DEPLOYMENT.md](./MAINNET_DEPLOYMENT.md) — how to avoid burning SOL and losing track of authorities on the path to mainnet-beta
