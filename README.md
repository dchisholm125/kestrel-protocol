# kestrel-protocol

Public-facing home for Kestrel Protocol.

This repo is intended to contain:
- the on-chain `kestrel-program/`
- public docs in `docs/`
- public tests in `tests/`
- public SDK work in `packages/sdk/`
- public examples in `examples/`

## Current contents
- `kestrel-program/` — Anchor/Solana program
- `docs/README.md` — public protocol overview
- `docs/ARCHITECTURE.md` — architecture and accounting model
- `docs/PRICING_MODEL.md` — public pricing structure (not secret coefficients)
- `docs/CURRENT_STATUS.md` — current proof/status summary
- `tests/` — cleaned devnet test harnesses

## Testing and Local Development

To run the devnet integration tests, you'll need to set up a local environment.

### 1. Prerequisites
- Node.js v20+ (v22 recommended)
- `npm install` in the project root (or inside `packages/sdk`)

### 2. Environment Setup
Create a `.env` file in the project root (not inside `packages/sdk/`):

```bash
DEVNET_RPC_URL=https://api.devnet.solana.com
DEVNET_PROGRAM_ID=3TaXEUn24hw4SncGP9aFskwSqsbhaZod14QEX2akLFxg
SOL_PRICE_USD=150
# Your devnet authority/payer keypair as a JSON array
DEVNET_PRIVATE_KEY=[...] 
```

### 3. Running Tests
Navigate to the SDK directory:
```bash
cd packages/sdk
```

**Quick End-to-End Test:**
Checks vault initialization, policy issuance, and settlement with a simulated Jupiter swap.
```bash
npm run test:quick:devnet
```

**Full Integration Test:**
Runs multiple scenarios (Happy Path and Claim Path) with real (or simulated fallback) Jupiter swaps on devnet.
```bash
npm run test:full:devnet
```

*Note: Use `DEBUG_ALL=true` before the commands to see detailed underwriting traces.*

## Notes
This repo should remain safe for public inspection.
Do not place private pricing internals, secret keys, raw ops notes, or proprietary calibration data here.
