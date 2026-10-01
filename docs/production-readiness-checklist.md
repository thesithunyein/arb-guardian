# Production Readiness Checklist

## Security and contracts
- [x] RBAC roles enforced for policy and execution paths
- [x] Pausable emergency circuit breaker
- [x] Input validation with custom errors
- [x] Contract tests for auth, limits, pause, and rollover

## Backend reliability
- [x] Request schema validation (Zod)
- [x] Incident action endpoint with explicit audit trail
- [x] KPI endpoint for measurable PMF evidence
- [x] Durable local persistence for runtime state
- [x] Rate limiting and API auth middleware

## Product quality
- [x] Evidence-first risk explanations with rule IDs
- [x] Incident lifecycle actions (acknowledge/mitigate/ignore)
- [x] Incident audit history UI
- [x] Dark / light mode with brand teal tokens
- [x] Scenario-based assess workflow (ops console UX)
- [x] Public live dashboard on Vercel

## Go-live gate for judging
- [x] Public production URL: https://arb-guardian.sithunyein.com (HTTP 200; DNS resolves to Vercel)
- [x] Vercel alias remains reachable: https://arb-guardian.vercel.app (HTTP 200)
- [x] Public repository: https://github.com/thesithunyein/arb-guardian
- [ ] Corrected Arbitrum Sepolia deployment — blocked: no deployer key, funded wallet, or explorer API key is available in this environment
- [x] Public product on Vercel with the recorded superseded onchain addresses clearly labelled
- [ ] Public API on Render (optional; console works with onchain reads)
- [ ] Demo video with onchain tx evidence on Arbiscan

## Bounty criteria map
| Criterion | Status |
| --- | --- |
| Deployed on Arbitrum chain | Existing Sepolia addresses are superseded; corrected redeploy required — see `docs/live-deployment.md` |
| Smart contract quality | Ready (tests + RBAC + pause) |
| Product-market fit | Ready (treasury ops console) |
| Innovation / creativity | Ready (deterministic agent playbooks) |
| Real problem solving | Ready (block before execution) |
| Best agentic track | Ready (eval harness + bounded actions) |
