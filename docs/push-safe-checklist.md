# Push-Safe Checklist (Real Product Only)

Use this before any remote push.

## Keep
- Source code in `apps`, `packages`, and `scripts`
- Core docs in `docs` (architecture, security, submission narrative)
- CI/workflow config in `.github`
- Deterministic test/evaluation harness

## Do not push
- Secrets (`.env`, private keys, API secrets)
- Runtime/generated state (`apps/api/data/runtime-state.json`)
- Generated bundle output (`docs/submission-bundle/`)
- Generated final submission output (`docs/final-submission-ready.md`) unless intentionally finalized
- Local build artifacts (`dist`, `node_modules`, `artifacts`, caches)

## Mandatory gate before push
1. `npm run preflight` (includes `push:audit`)
2. Review `git status --short`
3. Confirm only real source/docs/config files are included
4. Keep generated deployment evidence local until live tx hashes are final
5. Do not commit secrets or runtime JSON state
