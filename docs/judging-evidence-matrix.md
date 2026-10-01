# Judging Evidence Matrix

## Smart contract quality

- **Evidence:** `packages/contracts/contracts/PolicyManager.sol`, `ExecutionGuard.sol`, `SafeTreasuryGuard.sol`, `libraries/TokenCalldata.sol`
- **Proof points:**
  - RBAC (`DEFAULT_ADMIN_ROLE`, `POLICY_ADMIN_ROLE`, `OPERATOR_ROLE`, `GUARD_ADMIN_ROLE`)
  - Pausable safety controls; zero-address and invalid-amount guards; custom errors for explicit revert reasons
  - **Deny-by-default limits** in both lanes: an unconfigured wallet or Safe cannot spend; `UNLIMITED_LIMIT` must be granted explicitly
  - **Token lane**: register an ERC-20 (USDG first), allowlist counterparties, cap per wallet per day in the token's base units. A test pins the 18-vs-6 decimal trap a wei-denominated policy would have shipped
  - **Calldata-aware routing**: a registered token's `transfer`/`transferFrom`/`approve`/`increaseAllowance` is decoded and capped; an **unlimited approval is refused**; an unrecognised call on a registered token is rejected rather than falling through
  - **Real Gnosis Safe v1.4.1 integration** (`test/RealSafeGuard.test.ts`) — guard installed via a genuine `execTransaction` self-call (Safe 1.4.1 `setGuard` is `SelfAuthorized`), then shown blocking a spend that succeeds without it
  - Spend recorded pre-execution (no re-entrancy bypass) and **refunded** on failed execution
  - Bounds-checked assembly decoding isolated in one library
- **Validation command:** `npm run test -w packages/contracts` (57 tests)
- **Reproducible proof:** `npm run evidence -w packages/contracts` → 14/14 cases, before/after pair, exact revert reason per case

## Product-market fit

- **Evidence:** `docs/scope-lock.md`, `apps/web/src/App.tsx`, `apps/api/src/kpi.ts`
- **Proof points:**
  - The control every team delegating funds needs: an agent, bot or operator bounded by a contract rather than by trust
  - Denominated in the asset treasuries actually hold (a stablecoin lane, USDG first) rather than native wei
  - On the chains where those teams are being pointed: Arbitrum for mature DeFi and Safe tooling, Robinhood Chain for agents and USDG
  - Core workflows: policy setup, risk assessment, incident response
- **Validation command:** `npm run build -w apps/web`

## Innovation and creativity

- **Evidence:** `apps/api/src/riskEngine.ts`, `apps/api/src/agentCoordinator.ts`, `apps/api/src/playbookExecutor.ts`, `apps/api/src/evaluateAgent.ts`, `docs/agent-permissions-matrix.md`
- **Proof points:**
  - Deterministic evidence-first risk rules (no model in the loop)
  - Policy-bounded playbook recommendations
  - Bounded onchain mitigate (`PolicyManager.pause`) for critical playbooks
  - Event sync from `TransactionValidated` → incidents
  - Policy conformance fixtures: 14 fixed cases asserting the rule engine matches its written specification (**a regression suite, not model validation**)
- **Validation command:** `npm run eval:policy -w apps/api`

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
- **Deploy guide:** `docs/deploy-sepolia.md`
- **Deployment command:** `npm run deploy:p0`
