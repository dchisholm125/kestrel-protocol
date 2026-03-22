## Security

Token pair validation is enforced at two layers:
- SDK rejects unsupported pairs before hitting chain
- On-chain program rejects at contract level

v1 supports SOL/USDC only. Additional pairs 
require separate pricing calibration.

# Kestrel Protocol
Slippage insurance for Solana Jupiter swaps.

## What It Does
Before a swap, a user buys a policy that sets a slippage guarantee and locks the premium in a vault. If the executed swap slips beyond the guarantee, the vault pays the difference. If slippage stays within the guarantee, the premium is kept.

## Live Mainnet Proof
Program: 46PW8Yrw8KNtgLcmBEW9GQPjaYQJUxJSxM8KPBMJ5RMS
Vault:   EPGFuH2EnTG5fGvU6GaeAWzfgEUskGe6GozBUJriEu1J

First payout transaction:
  Policy:  4DgqNU6rRGamXMEnjL1fPwfHnJUmHpggDuZiW2MLCjpawYHLpxDAU5uwPo64BuoZLCbjUbgPB8ghcudE3NgGsrMu
  Swap:    4MojWcsUBqEG5DJMNFxt4wxxEp7qwNyFwjB26GBp2wk86mUMwBb9Nq1yceE32P1SmTLt623NhVwYw9kz4Rt95TXS
  Payout:  5EGSZsGAnsQozYCUFLHfRqLw5PnyjP3vaMGapJtHpX2PXGZYL2K8srhnCvQaxtUQ9XEDtC1DaYJac4FC8zxbFBhT

Second payout transaction:
  Policy:  51uAewCg8c3toRy5cDfhr4uaq4ENhtViHvFvuxQ2ZD3B7gwAEzHTCNwmuaixXFiqNZ6W2xexy6wqebQcWWgRzLbb
  Swap:    29V2PMjAtdhRt6WyXuyF865SaRT11K6BAW9porcuhSsBWvQhb62DQsQzbqwGAcAXCfjxPvE5SvDtYsuh6k1UwoYi
  Payout:  4Y78ZuScmLNkQWcFstzCdX6d24qXp8ndZqD6rh9N57YxXodAYwcAibNNTqTWczjNwfFHoLEngXnw71S93So7TfFK

## Pricing
75 bps guarantee → 20 bps premium
25 bps guarantee → 30 bps premium
10 bps guarantee → 50 bps premium
 5 bps guarantee → 80 bps premium
 1 bps guarantee → 200 bps premium

Priced from 134,000+ real Jupiter swap observations. Break-even stress multiplier: 2.79x current conditions.

## How It Works
1. Get a quote (check current regime + premium)
2. Issue policy (premium locked in vault)
3. Execute your Jupiter swap
4. Settle (vault pays excess slippage if breached, keeps premium if not)

## Architecture
- On-chain program: Anchor/Rust, Solana mainnet-beta
- Pricing: Off-chain, regime-aware (CALM/ELEVATED/HALTED)
- Settlement: Automatic, no claim filing required
- Data: 134k+ real SOL/USDC swap observations

## SDK
Coming soon: npm install @kestrel-protocol/sdk

## Status
✅ Live on Solana mainnet-beta
✅ Payout path proven on-chain
✅ Stress tested (5/5 scenarios passing)
⚠️  SDK in development
⚠️  Not audited — use at your own risk

## Contact
@BMan5280
