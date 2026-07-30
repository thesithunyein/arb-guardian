# Deploy to Arbitrum Sepolia (P0)

## 1. Configure environment

```bash
cp .env.example .env
```

Set in `.env`:

- `DEPLOYER_PRIVATE_KEY` — funded Arbitrum Sepolia wallet (no `0x` prefix in Hardhat config)
- `API_KEY` — strong random key for API mutations
- `OPERATOR_PRIVATE_KEY` — same as deployer if you want onchain validate + pause playbooks

Fund wallet via [Arbitrum Sepolia faucet](https://arbitrum.faucet.dev/).

## 2. One-command P0

```bash
npm run deploy:p0
```

This runs:

1. `deploy:sepolia:full` — deploy + seed demo policies
2. `submission:record-deploy` — writes `docs/deployment-evidence.md`
3. `submission:finalize` — writes `docs/final-submission-ready.md`

## 3. Deploy public API (Render)

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
vercel env add VITE_API_BASE_URL production
vercel env add VITE_API_KEY production
vercel env add VITE_POLICY_MANAGER_ADDRESS production
vercel env add VITE_EXECUTION_GUARD_ADDRESS production
```

Redeploy web: `vercel --prod`

## 5. Demo video checklist

Record 5–8 minutes showing:

1. Arbiscan contract addresses
2. Risky scenario → assess → blocked incident
3. **Validate onchain via ExecutionGuard** → revert tx on Arbiscan
4. Mitigate → policy pause tx (if operator key configured)
5. Audit trail in dashboard

## 6. Verify

```bash
npm run quality:gate
npm run demo:smoke
npm run submission:check
```
