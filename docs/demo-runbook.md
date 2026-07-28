# Demo Runbook (Judge Session)

## 1) Start services
- API: `npm run dev -w apps/api`
- Web: `npm run dev -w apps/web`

## 2) Seed realistic demo state
- `npm run demo:seed`

## 3) Verify endpoints before recording/live demo
- `npm run demo:smoke`

## 4) Present with timing
- Use `docs/demo-timing-track.md` as your script.

## 5) Backup if UI fails
- Use API endpoints directly:
  - `GET /health`
  - `POST /risk/assess`
  - `GET /incidents`
  - `POST /incidents/:incidentId/action`
  - `GET /incidents/audit`
