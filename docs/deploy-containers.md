# Container Deployment

## Local production-like run

1. Ensure Docker Desktop is running.
2. Optional: set `API_KEY` in shell or `.env`.
3. Build and run:
   - `docker compose up --build`

## Services

- Web UI: `http://localhost:8080`
- API: `http://localhost:8787`

## Notes

- API runtime state persists in `apps/api/data/runtime-state.json`.
- For cloud deployment, split API and web services and store state in managed Postgres.
