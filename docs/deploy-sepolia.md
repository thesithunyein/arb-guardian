# Deploy to Arbitrum Sepolia (P0)

> The current five-command flow is in `docs/live-deployment.md`. `npm run deploy:p0` is the original
> single-lane orchestrator and remains supported — it additionally records optional
> `docs/deployment-evidence.*` and generates `docs/final-submission-ready.md`.

## 1. Configure environment

```bash
cp .env.example .env
```

Set in `.env`:

- `DEPLOYER_PRIVATE_KEY` — funded Arbitrum Sepolia wallet (no `0x` prefix in Hardhat config)
- `OPERATOR_PRIVATE_KEY` — same as deployer if you want onchain validate + pause playbooks
- `ARBITRUM_SEPOLIA_RPC_URL` and `ROBINHOOD_TESTNET_RPC_URL` — for the twin lane
- `API_KEY` — strong random key for API mutations
- `ARBISCAN_API_KEY` — optional; `npm run verify:arbiscan` publishes the Arbiscan source panel once one exists

Fund wallet via [Arbitrum Sepolia faucet](https://arbitrum.faucet.dev/).

## 2. Deploy, enroll and verify

```bash
npm run deploy:preflight   # refuses until keys, balances and faucets hold
npm run redeploy:sepolia   # deploy + seed + real-Safe enrollment + source verification
npm run redeploy:robinhood # the twin lane
npm run repoint            # manifest -> current, app constants rewritten, proved on-chain
```

The legacy `npm run deploy:p0` runs the deploy and then writes
`docs/deployment-evidence.{md,json}` plus `docs/final-submission-ready.md`.

## 3. Public API

The production API is the Vercel serverless routes in `api/` (same-origin `/api/*`), covered by
`npm run test:api` and `/api/health`. The Render blueprint (`render.yaml`) is an optional, older
alternative:

1. Push repo to GitHub
2. [Render Blueprint](https://render.com/) → New Blueprint → connect repo (`render.yaml`)
3. Set env vars in Render dashboard:
   - `SUBMISSION_POLICY_MANAGER_ADDRESS`
   - `SUBMISSION_EXECUTION_GUARD_ADDRESS`
   - `SUBMISSION_POLICY_MANAGER_TX`
   - `SUBMISSION_EXECUTION_GUARD_TX`
   - `OPERATOR_PRIVATE_KEY` (for onchain validate / pause)
4. Copy Render URL → `SUBMISSION_API_URL` in `.env` and Vercel env `VITE_API_BASE_URL`

## 4. Update Vercel web env

```bash
vercel env add VITE_DEPLOYMENT_STATUS production
vercel env add VITE_POLICY_MANAGER_ADDRESS production
vercel env add VITE_EXECUTION_GUARD_ADDRESS production
vercel env add VITE_SAFE_TREASURY_GUARD_ADDRESS production
vercel env add VITE_RH_POLICY_MANAGER_ADDRESS production
vercel env add VITE_RH_EXECUTION_GUARD_ADDRESS production
```

Redeploy web: `vercel --prod` (or merge to `master` — Vercel builds on push).

## 5. Demo recording

Follow `docs/demo-runbook.md` for the shoot and `docs/demo-find-these.md` for the click labels; the
2:45 narration script is `docs/demo/narration-script.md`. The web path needs no wallet.

## 6. Verify

```bash
npm run quality:gate
npm run check:deployed
npm run check:settlement
npm run verify:sourcify
npm run demo:smoke
npm run submission:check
```
