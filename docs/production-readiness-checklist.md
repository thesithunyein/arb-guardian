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
- [x] Local runtime persistence for development and tests
- [ ] Durable production persistence for incidents, KPI, audit history, and waitlist
- [x] Rate limiting and API auth middleware

## Product quality
- [x] Evidence-first risk explanations with rule IDs
- [x] Incident lifecycle actions (acknowledge/mitigate/ignore)
- [x] Incident audit history UI
- [x] Dark / light mode with neutral product tokens
- [x] Scenario-based assess workflow (ops console UX)
- [x] Public live dashboard on Vercel

## Go-live gate for judging
- [x] Public production URL: https://arb-guardian.sithunyein.com (HTTP 200; DNS resolves to Vercel)
- [x] Vercel alias remains reachable: https://arb-guardian.vercel.app (HTTP 200)
- [x] Public repository: https://github.com/thesithunyein/arb-guardian
- [x] Corrected deployment on both lanes (2026-10-02), byte-matched to this source by `npm run check:deployed`
- [ ] Source published on Arbiscan — the one open verification item; needs `ARBISCAN_API_KEY`, then `npm run verify -w packages/contracts -- --network arbitrumSepolia`
- [x] Source verified on the Robinhood explorer (`Pass - Verified`, 3/3 contracts)
- [x] Guard installed on a real Gnosis Safe through that Safe's own `execTransaction`, on both lanes
- [x] Allowed and refused Safe transactions recorded onchain (both lanes)
- [x] Durable production storage: incidents, KPI and audit history survive a new serverless instance (`/api/health` reports `vercel-kv`, reachable)
- [x] Public product on Vercel with the current onchain addresses and transaction links on screen
- [ ] Public API on Render (optional; console works with onchain reads)
- [ ] Demo video with onchain tx evidence on Arbiscan

## Bounty criteria map
| Criterion | Status |
| --- | --- |
| Deployed on Arbitrum chain | Both lanes deployed 2026-10-02 and declared `current`, 6/6 drift claims holding; source panel on Arbiscan still needs a key — see `docs/live-deployment.md` |
| Smart contract quality | Ready (tests + RBAC + pause) |
| Product-market fit | Evidence-ready workflow; pilot metrics still required |
| Innovation / creativity | Evidence-ready Safe enforcement + policy attestation; comparative proof still required |
| Real problem solving | Allowed and refused Safe transactions recorded onchain on both lanes; incident drill still to be run and documented |
| Best agentic track | Deterministic, bounded actions; no autonomous fund movement |
