# Arb Guardian

Arb Guardian is a treasury risk operations product for Arbitrum-native teams.  
It combines onchain policy enforcement with evidence-based incident response automation.

## Monorepo layout

- `apps/web` - operator dashboard
- `apps/api` - risk engine and agent coordinator
- `packages/contracts` - Solidity contracts, deployment, and tests
- `packages/shared` - shared types and validation schemas
- `docs` - product, architecture, threat model, and demo materials

## Quick start

1. Install dependencies:
   - `npm install`
2. Start API:
   - `npm run dev -w apps/api`
3. Start web app:
   - `npm run dev -w apps/web`
4. Build contracts and run tests:
   - `npm run test -w packages/contracts`

## Container runtime

- Start full stack:
  - `docker compose up --build`
- API available at `http://localhost:8787`
- Web available at `http://localhost:8080`

## Environment setup

- Copy `.env.example` to `.env` at repo root for API/deployment settings.
- Optional web env for API endpoint and key:
  - copy `apps/web/.env.example` to `apps/web/.env`

## Submission assets

- `docs/final-submission-copy.md` for copy/paste application text
- `docs/judging-evidence-matrix.md` for criterion-to-proof mapping
- `docs/demo-timing-track.md` for a timed 3-minute walkthrough
- `docs/push-safe-checklist.md` to keep repo real and clean before pushing

## Release commands

- Full quality gate:
  - `npm run quality:gate`
- Submission structure + placeholder check:
  - `npm run submission:check`
- Generate final ready-to-submit text:
  - `npm run submission:finalize`
- Record onchain deployment evidence:
  - `npm run submission:record-deploy`
- Export all submission assets into one folder:
  - `npm run submission:bundle`
- Seed realistic demo data:
  - `npm run demo:seed`
- Verify demo endpoints quickly:
  - `npm run demo:smoke`
- Complete preflight:
  - `npm run preflight`
- Push-safe dry-run audit (what would be staged):
  - `npm run push:audit`

## Security baseline

- RBAC for policy and execution actions
- Pausable circuit breaker for emergency halts
- Full audit log via events and incident records
- Deterministic risk evidence (no fabricated agent output)
