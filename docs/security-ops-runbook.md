# Security and Ops Runbook

## API protection defaults

- Helmet security headers enabled.
- Global rate limiting: 120 requests per minute per IP.
- Mutating endpoints (`/risk/assess`, `/incidents/:id/action`) support `x-api-key` protection via `API_KEY`.

## Incident operations flow

1. Assess transaction via `/risk/assess`.
2. Review incident and evidence.
3. Execute action via `/incidents/:incidentId/action`.
4. Verify immutable action history in `/incidents/audit`.

## Persistence model

- Runtime data is stored at `apps/api/data/runtime-state.json`.
- State includes assessments, incidents, and incident audit log.

## Recommended production upgrades

- Replace local JSON persistence with Postgres.
- Add service-to-service auth for internal routes.
- Add centralized logs and alerting on critical incidents.
