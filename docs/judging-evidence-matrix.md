# Judging Evidence Matrix

## Smart contract quality

- **Evidence:** `packages/contracts/contracts/PolicyManager.sol`, `packages/contracts/contracts/ExecutionGuard.sol`
- **Proof points:**
  - RBAC (`DEFAULT_ADMIN_ROLE`, `POLICY_ADMIN_ROLE`, `OPERATOR_ROLE`)
  - Pausable safety controls
  - Zero-address and invalid-amount guards
  - Custom errors for explicit revert reasons
- **Validation command:** `npm run test -w packages/contracts`

## Product-market fit

- **Evidence:** `docs/scope-lock.md`, `apps/web/src/App.tsx`, `apps/api/src/kpi.ts`
- **Proof points:**
  - Clear treasury operator persona
  - Core workflows: policy setup, risk assessment, incident response
  - KPI dashboard for blocked rate, critical incidents, and score trends
- **Validation command:** `npm run build -w apps/web`

## Innovation and creativity

- **Evidence:** `apps/api/src/riskEngine.ts`, `apps/api/src/agentCoordinator.ts`, `apps/api/src/evaluateAgent.ts`
- **Proof points:**
  - Deterministic evidence-first risk rules
  - Policy-bounded agent playbook recommendations
  - Reproducible agent evaluation metrics (accuracy/precision/recall)
- **Validation command:** `npm run eval:agent -w apps/api`

## Real problem solving

- **Evidence:** `apps/api/src/server.ts`, `apps/api/src/incidentStore.ts`, `apps/web/src/App.tsx`
- **Proof points:**
  - Risky transaction blocked before execution
  - Incident created with explainable evidence
  - Operator can execute lifecycle actions and audit trail logs
- **Validation command:** `npm run test -w apps/api`

## Deployment qualification

- **Required proof:** Arbitrum chain deployment addresses + transaction links
- **Live product:** https://arb-guardian.vercel.app
- **Public repo:** https://github.com/thesithunyein/arb-guardian
- **Deployment command:** `npm run deploy:sepolia -w packages/contracts`
