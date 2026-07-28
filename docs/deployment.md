# Arbitrum Sepolia Deployment

## Prerequisites

- Node.js 20+
- Funded Arbitrum Sepolia deployer wallet
- `.env` file with:
  - `ARBITRUM_SEPOLIA_RPC_URL`
  - `DEPLOYER_PRIVATE_KEY`

## Steps

1. Install dependencies:
   - `npm install`
2. Run contract tests:
   - `npm run test -w packages/contracts`
3. Deploy contracts:
   - `npm run deploy:sepolia -w packages/contracts`
4. Deploy script writes local-only evidence to `packages/contracts/deployments/` (gitignored).
5. Copy printed `SUBMISSION_*` values into root `.env`, then run:
   - `npm run submission:record-deploy`
   - `npm run submission:finalize`
6. Save deployed addresses in app env (`apps/web/.env`) for dashboard display.

## Post-deploy checklist

- Verify roles are assigned correctly.
- Set initial allowlist + wallet limits.
- Dry-run one blocked and one allowed transaction flow.
- Confirm `/status` reports `productReady: true`.
