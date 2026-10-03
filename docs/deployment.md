# Arbitrum Sepolia Deployment

> The current, checked path is the dual-lane flow below; `docs/live-deployment.md` records what it
> produced on 2026-10-02. `npm run deploy:p0` is the original single-lane orchestrator and still
> works: it deploys, writes `SUBMISSION_*` values into `.env`, records optional
> `docs/deployment-evidence.*`, and generates `docs/final-submission-ready.md`.

## Prerequisites

- Node.js 20+
- Funded Arbitrum Sepolia deployer wallet (plus a funded Robinhood Chain Testnet wallet for the twin lane)
- `.env` file with:
  - `ARBITRUM_SEPOLIA_RPC_URL` / `ROBINHOOD_TESTNET_RPC_URL`
  - `DEPLOYER_PRIVATE_KEY`
  - `OPERATOR_PRIVATE_KEY` (drills and pause/unpause)

## Steps

1. Install dependencies:
   - `npm install`
2. Run contract tests:
   - `npm run test -w packages/contracts`
3. `npm run deploy:preflight` — refuses until keys, balances and faucets hold, and names the faucets.
4. `npm run redeploy:sepolia` — deploy + seed + real-Safe enrollment + source verification.
5. `npm run redeploy:robinhood` — the same on the twin lane.
6. `npm run repoint` — flips the manifest to `current`, rewrites the app constants, then proves both on-chain.
7. `npm run check:deployed` — 6/6 bytecode claims or a non-zero exit.

Deployment artifacts are written to `packages/contracts/deployments/` (gitignored); the committed
record is `packages/contracts/evidence/live-deployments.json`.

## Post-deploy checklist

- Verify roles are assigned correctly.
- Set the allowlist, wallet limits and the USDG lane; `npm run check:settlement` reads them back.
- Dry-run one blocked and one allowed transaction flow — `docs/live-deployment.md` has the executed pair.
- Confirm `/api/status` reports `productReady: true`; `/api/health` reports `vercel-kv`.
- Run the freeze drill once: `npm run drill:incident:sepolia`.
