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
- [x] Durable production persistence for incidents, KPI, audit history, and waitlist (Vercel KV; `/api/health` reports `vercel-kv`, reachable)
- [x] Rate limiting and API auth middleware

## Product quality
- [x] Evidence-first risk explanations with rule IDs
- [x] Incident lifecycle actions (acknowledge/mitigate/ignore)
- [x] Incident audit history UI
- [x] Dark / light mode with neutral product tokens
- [x] Scenario-based assess workflow (ops console UX)
- [x] Public live dashboard on Vercel

## Go-live gate
- [x] Public production URL: https://arb-guardian.sithunyein.com (HTTP 200; DNS resolves to Vercel)
- [x] Vercel alias remains reachable: https://arb-guardian.vercel.app (HTTP 200)
- [x] Public repository: https://github.com/thesithunyein/arb-guardian
- [x] Corrected deployment on both lanes (2026-10-02), byte-matched to this source by `npm run check:deployed`
- [x] Source published, keylessly: Sourcify answers `exact_match` for all six contracts (creation and runtime bytecode), recorded in `packages/contracts/evidence/sourcify.json` by `npm run verify:sourcify`
- [x] Every contract reads as verified on its explorer panel — Arbitrum Sepolia (Blockscout) and Robinhood Chain Testnet
- [ ] Arbiscan's own source panel — the one open verification item, and it is waiting only on a free Etherscan API key (`ARBISCAN_API_KEY` in `.env`). `npm run verify:arbiscan` submits, waits, reads the result back and records it (`evidence/arbiscan.json`, rendered on the site); without a key it records `pending_key` and exits 0, and an unreadable panel is recorded as `read_failed` rather than as an unpublished contract. It already runs inside `npm run preflight`
- [x] Guard installed on a real Gnosis Safe through that Safe's own `execTransaction`, on both lanes
- [x] Allowed and refused Safe transactions recorded onchain (both lanes)
- [x] Durable production storage: incidents, KPI and audit history survive a new serverless instance (`/api/health` reports `vercel-kv`, reachable)
- [x] Public product on Vercel with the current onchain addresses and transaction links on screen
- [x] Public API live on Vercel serverless routes (`/api/*`, durable KV); the Render blueprint remains an optional alternative
- [x] Freeze drill run end to end against the live lane (refused decision → on-chain pause → refusal while frozen → unpause → resume), recorded in `docs/incident-drill.md`
- [x] Screen capture of the live product along the operator path
- [ ] Narrated walkthrough with the blocked transaction spoken over it
- [ ] Bounded USDG payment on a live lane — blocked by the issuer's geo-restricted testnet faucet

## Evidence artifacts added after the deployment
- [x] Freeze drill executed against the live lane, with hashes, gas and timings (`docs/incident-drill.md`)
- [x] Source publication recorded keylessly (6/6 Sourcify exact match, verified explorer panels on both lanes)
- [ ] Arbiscan's own source panel (waiting on `ARBISCAN_API_KEY`; `npm run verify:arbiscan`)
- [x] USDG lane configuration read back from each `PolicyManager` by `npm run check:settlement`
- [x] Capability comparison against alert-only, manual multisig, and signer-side policy (README + site)
- [x] Internal enforcement review, labelled internal, with findings and residual risk (`docs/internal-review.md`)
- [x] Silent screen capture of the live product
- [ ] Narrated walkthrough — the script is written, the voice is not recorded

## Open items

| Item | Status |
| --- | --- |
| Arbiscan source panel | Waiting on a free `ARBISCAN_API_KEY` in `.env`; `npm run verify:arbiscan` publishes and records it |
| Bounded USDG payment on a live lane | Lane configured and capped on both chains; blocked by the issuer's geo-restricted testnet faucet |
