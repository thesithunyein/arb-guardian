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
- 69 Hardhat tests including rollover, pause, deny-by-default and the 18-vs-6 decimal trap.
- **SafeTreasuryGuard** — Gnosis Safe `ITransactionGuard` for production multisig treasuries.
- **Deny-by-default** limits in both the native and token lanes: `0` blocks spending, uncapped
  spending requires an explicit `UNLIMITED_LIMIT`.
- **Versioned policy attestation** — every policy amendment folds into a hash chain that replays
  from logs alone, and every decision record carries the version and digest that judged it.
- **Reproducible proof** — `npm run evidence -w packages/contracts` runs 15 cases against a real
  Gnosis Safe v1.4.1 and exits non-zero if any case drifts.

## Demo flow

1. Configure the allowlist, the per-asset caps and the token lane.
2. Submit a spend from an agent, bot or operator key.
3. Show the refusal, the revert reason, and the policy version stamped on the allowed ones.
4. Show the Evidence tab: the proof is the generated artifact (drift report, source publication, guard cases, attestation), not prose.
5. Show SafeTreasuryGuard as the enforcement path inside a real Safe's `execTransaction`.

## Scale roadmap

- Both lanes run the current build (token lane + attestation) and are source-published; next is a
  narrated demo and a first external pilot.
- Enroll further real Gnosis Safe instances through SafeTreasuryGuard, starting with the pilot's.
- Introduce queue-backed event ingestion and alerting.
- Expand policy templates for payroll, grant disbursement, and market ops.
