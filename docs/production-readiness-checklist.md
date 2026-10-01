# Production Readiness Checklist

## Security and contracts
- [x] RBAC roles enforced for policy and execution paths
- [x] Pausable emergency circuit breaker
- [x] Input validation with custom errors
- [x] Contract tests for auth, limits, pause, and rollover
- [x] Invariant tests: the cap holds after every step of a randomised spend sequence, a zero cap is absolute, only the explicit sentinel is uncapped, a freeze refuses every lane, and the lanes cannot leak into each other (`test/Invariants.test.ts`)
- [x] [SECURITY.md](../SECURITY.md): trust assumptions, deliberate limits, and the defects found and fixed
- [ ] Third-party audit — not done, and stated as not done

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
- [x] Operator-entered spend preflight: the verdict is read from the contract for the addresses supplied, and refuses when it cannot read them
- [x] Public live dashboard on Vercel

## Go-live gate for judging
- [x] Public staging URL: https://arb-guardian.vercel.app
- [x] Public repository: https://github.com/thesithunyein/arb-guardian
- [x] Arbitrum Sepolia deployment — PolicyManager + ExecutionGuard live
- [x] Robinhood Chain Testnet deployment — same artifact set, second lane
- [x] Public product on Vercel with onchain addresses
- [x] Settlement token (Paxos USDG) addresses and decimals read from the contracts on both lanes (`npm run check:settlement`)
- [x] Recording sheet generated from the committed evidence, not written by hand (`npm run demo:sheet`)
- [ ] **Redeploy both lanes with the current build** — the live addresses are an earlier, weaker build; see `docs/live-deployment.md`
- [ ] Public API on Render (optional; console works with onchain reads)
- [ ] Demo video with onchain tx evidence on Arbiscan

## Judging criteria map

The four criteria are the ones the buildathon actually states, and each names the artifact a judge can
check rather than an adjective.

| Criterion | Where the evidence is | Honest state |
| --- | --- | --- |
| Deployed on an Arbitrum chain | Arbitrum Sepolia + Robinhood Chain Testnet — `docs/live-deployment.md` | Live, but an **earlier build**; redeploy pending |
| Smart contract quality | 71 contract tests incl. invariants · evidence pack · `npm run check:deployed` | Strong on source; the deployed bytecode is behind it |
| Product-market fit | Operator console, waitlist, usage counts | **Weakest area.** No users yet beyond a waitlist |
| Innovation and creativity | Hash-chained policy attestation, replayed from logs; per-decision version stamping | The standout claim, and it is machine-checked |
| Real problem solving | Deny-by-default limits, USDG token lane, guard inside a real Safe | Solid; the enforced path is the Safe guard |
| Extra consideration: Paxos USDG | Real USDG on both lanes, decimals read from the token | Address verified; caps rail live after redeploy |
