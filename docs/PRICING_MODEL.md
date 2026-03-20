# Kestrel Pricing Model

This document describes the current pricing model direction for Kestrel Protocol.

It is intentionally conservative and operationally grounded.
The goal is not to sound mathematically impressive.
The goal is to define pricing that is:

- understandable
- calibratable
- reserve-aware
- regime-aware
- compatible with current tested protocol behavior

---

## 1. What Kestrel is pricing

Kestrel is pricing **single-transaction execution risk**.

More specifically, it prices the risk that:

> **the realized execution cost of a specific swap exceeds the user’s protected threshold.**

So the object being priced is:
- one swap
- one amount
- one live market regime
- one bounded liability profile
- one short-lived policy window

---

## 2. User-facing pricing goal

The product should feel simple:

> **Can you guarantee this trade inside my acceptable execution bound?**

Internally, the premium must reflect:
- expected loss
- tail risk
- capital usage
- adverse selection
- protocol margin

That is the core pricing truth.

---

## 3. Canonical premium decomposition

The first-pass premium decomposition remains:

`premium = expected_loss + tail_load + capital_charge + protocol_margin`

The working simulation model expands this further into:

`premium_bps = base_rate_bps + expected_excess_loss_bps + volatility_load_bps + capital_load_bps + adverse_selection_load_bps + profit_margin_bps`

This is the formula now used in the pricing simulation and calibration workbench.

---

## 4. Current tested pricing components

## 4.1 Base rate
A floor charge to avoid underpricing small policies and to account for protocol overhead.

## 4.2 Expected excess loss
Expected excess slippage beyond the guaranteed threshold.

## 4.3 Volatility load
Charge for unstable conditions and fatter slippage tails.

## 4.4 Capital load
Charge for tying up reserve / capacity while the policy is live.

## 4.5 Adverse-selection load
Charge for the fact that users are more likely to buy protection when conditions are dangerous.

## 4.6 Profit margin
Positive spread above pure actuarial break-even.

---

## 5. Pricing unit

Kestrel should still think in **basis points on notional**.

Useful definitions:
- `notional_usd`
- `premium_bps`
- `premium_usd`
- `covered_bps`
- `realized_bps`
- `liability_cap_usd`

This keeps slippage, premium, payout, and policy limit in the same language.

---

## 6. Canonical payout model

A pricing-friendly payout form remains:

`payout_usd = min(liability_cap_usd, notional_usd * max(0, realized_bps - covered_bps) / 10,000)`

This matters because pricing only makes sense if payout is:
- explicit
- bounded
- reserveable

### Current implementation note
The tested devnet flow now supports explicit payout amounts during settlement, which is a major step forward from earlier premium-refund placeholder behavior.

That means the pricing model is now materially closer to the protocol’s actual claim behavior.

---

## 7. Current simulation framework

The repository now includes a working pricing simulation path that:
- reads real slippage-cache data
- computes premiums from current formula inputs
- supports cap/gamma/threshold sensitivity sweeps
- supports regime-aware comparisons
- compares model output to the earlier `75 bps / 20 bps` heuristic intuition

This is important because pricing is no longer just a doc fantasy.
It is now something the repo can actually simulate and compare.

---

## 8. Regime-aware pricing

One of the most important current developments is that pricing is no longer assumed to be static.

The live market abstraction now supports:
- `CALM`
- `ELEVATED`
- `HALTED`

with current client/test logic using a recent breach-rate signal to classify market state.

### Current regime interpretation
- **CALM**: normal market, underwriting open, lower premium
- **ELEVATED**: wider premium, warning-level market stress
- **HALTED**: underwriting closed via circuit-breaker behavior

This is important because the protocol should not price toxic or chaotic flow as if it were normal flow.

---

## 9. Pricing and capacity are now linked

A major architectural truth now reflected in the code is:

> **pricing cannot be separated from capacity and reserve usage**

The vault now tracks:
- premiums collected
- payouts made
- active exposure

And issuance now has on-chain capacity enforcement.

That means pricing is not just about expected loss anymore.
It is also about whether the protocol should be allowed to carry that risk at all.

---

## 10. Current capital interpretation

The pricing model must recognize that capital is not free.

A policy consumes capacity while it is active.
That is why the pricing simulation includes a capital charge and why the protocol now tracks active exposure explicitly.

### Practical consequence
If two policies have similar expected loss but one ties up much more effective capacity, they should not necessarily have the same premium.

---

## 11. Reserve-aware / solvency-aware pricing

Pricing and underwriting must respect reserve state.

That implies at least these guardrails:
- minimum premium floor
- bounded policy limit
- reserve sufficiency
- active exposure tracking
- circuit-breaker behavior under stress

### Important current development
On-chain issuance now includes solvency/capacity enforcement.
So the client is no longer the only thing protecting the vault from over-issuance.

That is a major improvement in economic integrity.

---

## 12. Calibration lessons learned so far

The simulation work surfaced an important truth:

- pure expected excess loss above a threshold can be tiny
- but premium still needs to cover capital lock, adverse selection, and operational safety

That means naive EV-only pricing would dramatically undercharge.

### Practical lesson
The premium is not just “what average claims cost.”
It is also “what it costs to safely carry the risk.”

---

## 13. Capacity stress interpretation

The current stress suite shows that capacity enforcement exists, but the exact speed at which tests hit the ceiling depends on:
- vault size
- configured exposure cap
- test notional size
- premium size

So capacity stress tests should be interpreted as a combination of:
- protocol correctness
- and calibration choice

A slow-to-hit ceiling is not necessarily a bug if the cap is genuinely wide relative to the test size.

---

## 14. Current implementation posture

Kestrel should still price conservatively.

That means preferring:
- explicit floor premiums
- bounded issuance
- regime-sensitive widening
- capacity awareness
- and refusal to underwrite when conditions are not acceptable

rather than pretending to be a perfectly efficient mature insurer on day one.

That is the correct posture.

---

## 15. What the pricing model should avoid

- pretending precision we do not have
- pricing solely on average slippage
- ignoring active exposure and reserve usage
- promising uncapped liability
- pushing too many knobs onto the user
- relying only on client-side solvency checks

---

## 16. Recommended current interpretation

The best way to interpret Kestrel pricing today is:

> **a conservative, regime-aware execution-risk premium that now sits on top of real policy/accounting mechanics rather than just a theoretical pricing note.**

That is a major step forward from earlier design-only phases.

---

## 17. Open questions still worth solving

1. Should `MAX_EXPOSURE_BPS` remain a constant or become configurable per vault?
2. How should production pricing state eventually move on-chain?
3. How should live route-specific risk enter the premium path?
4. What mainnet calibration should map to retail vs institutional policy tiers?
5. How should withdrawal behavior and reserve floor inform treasury policy?
6. How should pricing react when `kestrel:collect` and live issuance are running simultaneously?

---

## 18. Bottom line

Kestrel pricing should now be understood as the economic control surface of the protocol.

It is no longer just:
- a quote formula
or
- a design aspiration

It is now tied directly to:
- settlement behavior
- active exposure accounting
- on-chain issuance enforcement
- and vault safety

That is the right direction for a real execution-protection protocol.
