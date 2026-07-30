# Arb Guardian Judge Brief

## One-line pitch

Arb Guardian is a treasury risk-ops platform that blocks unsafe transactions before execution and provides policy-bounded incident response for Arbitrum-native teams.

## Why this matters now

Small DAOs and onchain startups lose funds from approval misuse, weak operational controls, and delayed incident response. Existing tooling is fragmented; guardrails are either too manual or too opaque.

## Core innovation

- Deterministic onchain policy enforcement with auditable contract events.
- Evidence-first risk scoring (rule IDs + reasons, no fabricated AI output).
- Agentic playbook recommendation constrained by explicit policy permissions.

## PMF target

- Primary users: treasury signers, finance ops leads, protocol operators.
- Use cases: pre-execution policy checks, risky approval interception, incident triage.

## Smart contract quality signals

- RBAC roles for policy and operations.
- Pausable circuit breaker.
- Zero-address and invalid-amount guards.
- Custom errors for clear failure reasons.
- Comprehensive Hardhat tests including rollover and pause scenarios.
- **SafeTreasuryGuard** — Gnosis Safe `ITransactionGuard` for production multisig treasuries.

## Demo flow

1. Configure allowlist + wallet limit.
2. Submit risky approval transaction.
3. Observe blocked transaction and event-backed evidence.
4. Review auto-created incident and playbook recommendation.
5. Show SafeTreasuryGuard as the Safe multisig enforcement path.

## Scale roadmap

- Wire live Gnosis Safe instances to SafeTreasuryGuard enrollment.
- Introduce queue-backed event ingestion and alerting.
- Expand policy templates for payroll, grant disbursement, and market ops.
