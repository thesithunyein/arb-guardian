# Final Submission Copy (HackQuest)

## Project name
Arb Guardian

## One-sentence summary
Arb Guardian is a treasury risk-ops platform for Arbitrum teams that blocks unsafe transactions before execution and automates policy-bounded incident response with auditable evidence.

## Problem
Treasury teams in DAOs and onchain startups face high risk from unsafe approvals, counterparty mistakes, and delayed incident response. Existing tools often separate policy controls, monitoring, and response workflows, increasing operational risk.

## Solution
Arb Guardian unifies:
- onchain policy guardrails (allowlist + wallet limits + RBAC + pause),
- deterministic risk scoring with explicit rule evidence,
- incident lifecycle actions and audit trail,
- policy-bounded agentic playbook recommendations.

## Why Arbitrum
Arbitrum provides scalable EVM-compatible infrastructure where treasury operations can enforce reliable guardrails with low latency and strong ecosystem compatibility.

## Key features
- PolicyManager and ExecutionGuard smart contracts
- Pre-execution risk assessment endpoint
- KPI and evidence dashboard for operators
- Incident actions: acknowledge, mitigate, ignore
- Incident audit log for accountability
- Agent evaluation harness with measurable performance metrics

## Judging criteria alignment
- **Smart contract quality:** tested Solidity contracts, RBAC, pause controls, custom errors, security guards.
- **Product-market fit:** focused on treasury signers and finance ops with clear recurring need.
- **Innovation and creativity:** deterministic evidence engine + policy-bounded agentic recommendations.
- **Real problem solving:** blocks unsafe transactions and guides incident response in one operational workflow.

## Live/demo links
- Web app URL: `https://arb-guardian.vercel.app`
- API URL: `<fill_api_url>` (deploy via `render.yaml` — see `docs/deploy-sepolia.md`)
- Demo video: `<fill_demo_url>` (record after Sepolia + API live)
- Repo URL: `https://github.com/thesithunyein/arb-guardian`

## Contract addresses (Arbitrum chain)
- PolicyManager: `<fill_policy_address>`
- ExecutionGuard: `<fill_guard_address>`

## Deployment transactions
- PolicyManager tx: `<fill_policy_tx>`
- ExecutionGuard tx: `<fill_guard_tx>`

## What we validated
- Contract tests pass (`npm run test -w packages/contracts`)
- API unit/integration tests pass (`npm run test -w apps/api`)
- Agent evaluation passes with full scenario coverage (`npm run eval:agent -w apps/api`)
- Production build passes for API and web
