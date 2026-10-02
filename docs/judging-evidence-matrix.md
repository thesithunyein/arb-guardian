# Judging Evidence Matrix

## Smart contract quality

- **Evidence:** `packages/contracts/contracts/PolicyManager.sol`, `ExecutionGuard.sol`, `SafeTreasuryGuard.sol`, `libraries/TokenCalldata.sol`
- **Proof points:**
  - RBAC (`DEFAULT_ADMIN_ROLE`, `POLICY_ADMIN_ROLE`, `OPERATOR_ROLE`, `GUARD_ADMIN_ROLE`)
  - Pausable safety controls; zero-address and invalid-amount guards; custom errors for explicit revert reasons
  - **Deny-by-default limits** in both lanes: an unconfigured wallet or Safe cannot spend; `UNLIMITED_LIMIT` must be granted explicitly
  - **Token lane**: register an ERC-20 (USDG first), allowlist counterparties, cap per wallet per day in the token's base units. A test pins the 18-vs-6 decimal trap a wei-denominated policy would have shipped
  - **Calldata-aware routing**: a registered token's `transfer`/`transferFrom` is decoded and capped; `transferFrom` must name the Safe as its source; **all standing approvals are refused** because a spender could exercise them outside daily-cap accounting; an unrecognised call on a registered token is rejected rather than falling through
  - **Real Gnosis Safe v1.4.1 integration** (`test/RealSafeGuard.test.ts`) — guard installed via a genuine `execTransaction` self-call (Safe 1.4.1 `setGuard` is `SelfAuthorized`), then shown blocking a spend that succeeds without it
  - Spend recorded pre-execution (no re-entrancy bypass) and **refunded** on failed execution
  - Bounds-checked assembly decoding isolated in one library
  - **Versioned policy attestation**: every policy mutation advances a hash-chained `policyVersion` / `policyDigest`, the amendment is emitted with its parameters so the chain replays from logs alone, and every decision record carries the version and digest that judged it (`test/PolicyAttestation.test.ts`)
- **Validation command:** `npm run test -w packages/contracts` (65 tests)
- **Integration path:** `npm run example:operator -w packages/contracts` — a runnable operator bot that dry-runs policy, decodes the refusal, and records the policy version/digest of each allowed decision. Exercised in CI.
- **Reproducible proof:** `npm run evidence -w packages/contracts` → 15/15 cases, before/after pair, exact revert reason per case, plus an 11-amendment digest-chain replay with 5/5 allowed decisions stamped
- **One policy client:** the ABI, role hashes, limit semantics and revert decoding live once, in `packages/shared/src/policy.ts`, and are consumed by the web app and the API. Previously four hand-written copies, one of which had already drifted past the token lane and the attestation
- **Logic tests:** `npm run test -w packages/shared` (20) — `0` blocks, `UNLIMITED_LIMIT` uncaps, the role matrix (`pause` is not `POLICY_ADMIN_ROLE`), 6-decimal parsing, and refusal messages
- **Live client tests:** `npm run test -w apps/api` (21, including 4 live) — the shared client is driven against the deployed PolicyManager by read-only `eth_call` from a throwaway address, proving the ABI names functions that exist and that a real `AccessControlUnauthorizedAccount` is decoded into an actionable refusal. No key, no gas, no state change
- **Route integrity:** `npm run check:routes` proves every `/api/...` path the app fetches has a handler on disk. It was added after a rename shipped `/api/treasurys` against a handler named `treasuries.ts` — a 404 that returned a happy 200 from the dev server's SPA fallback
- **Typecheck:** `npm run typecheck` is clean across all four workspaces, including the Vercel handlers in `api/` that no workspace tsconfig covered
- **Live-vs-repo check:** `npm run check:deployed` reads the bytecode at every recorded address over public RPC (no keys) and compares the Solidity metadata fingerprint and runtime size with this build → 6 contracts read, 6 declared `superseded` and confirmed to differ (PolicyManager is 2,098 bytes on-chain against 4,631 here). Each network declares whether it must match this source, and the script fails when the declaration and the chain disagree

## Product-market fit

- **Evidence:** `docs/scope-lock.md`, `apps/web/src/App.tsx`, `apps/api/src/kpi.ts`
- **Proof points:**
  - The control every team delegating funds needs: an agent, bot or operator bounded by a contract rather than by trust
  - Denominated in the asset treasuries actually hold (a stablecoin lane, USDG first) rather than native wei
  - On the chains where those teams are being pointed: Arbitrum for mature DeFi and Safe tooling, Robinhood Chain for agents and USDG
  - Core workflows: policy setup, risk assessment, incident response
- **Validation command:** `npm run build -w apps/web`
- **Honesty gate:** the Vault tab renders the generated drift report, so the superseded status a judge sees on screen comes from `evidence/deployed-drift.json` rather than from marketing copy

## Innovation and creativity

- **Evidence:** `apps/api/src/riskEngine.ts`, `apps/api/src/agentCoordinator.ts`, `apps/api/src/playbookExecutor.ts`, `apps/api/src/evaluateAgent.ts`, `docs/agent-permissions-matrix.md`
- **Proof points:**
  - Deterministic evidence-first risk rules (no model in the loop)
  - Policy-bounded playbook recommendations
  - Bounded onchain mitigate (`PolicyManager.pause`) for critical playbooks
  - Event sync from `TransactionValidated` → incidents
  - Policy conformance fixtures: 14 fixed cases asserting the rule engine matches its written specification (**a regression suite, not model validation**)
  - **Tamper-evident policy history**: an amendment log that is recomputable from logs, so "what policy allowed this spend?" has a cryptographic answer rather than a git blame
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
- **Live product:** https://arb-guardian.sithunyein.com (Vercel alias: https://arb-guardian.vercel.app)
- **Public repo:** https://github.com/thesithunyein/arb-guardian
- **Deploy guide:** `docs/deploy-sepolia.md`
- **Deployment command:** `npm run deploy:p0`
