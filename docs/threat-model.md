# Threat Model (MVP)

## Primary threats

- Unauthorized policy modifications.
- Unsafe destination approvals/transfers.
- Daily spend limit bypass via repeated low-value transfers.
- Operational lag during incident response.

## Controls implemented

- RBAC (`DEFAULT_ADMIN_ROLE`, `POLICY_ADMIN_ROLE`, `OPERATOR_ROLE`).
- Contract pausable kill switch.
- Allowlist and wallet daily-limit checks in `ExecutionGuard`.
- Deterministic risk explanation with explicit rule IDs and reasons.
- Incident records with recommended bounded playbooks.

## Remaining risks

- Admin key compromise (mitigate with multisig and hardware wallets).
- Incomplete offchain event ingestion (mitigate with retries + durable queue).
- False positives from deterministic thresholds (mitigate with policy tuning).
