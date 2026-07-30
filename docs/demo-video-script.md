# Demo Video Script (5–7 min) — Judge Recording

Record this once and submit the URL on HackQuest.

## Setup (before record)
1. Open https://arb-guardian.vercel.app (dark mode)
2. Open Arbiscan tabs for PolicyManager + ExecutionGuard + SafeTreasuryGuard
3. Optional: MetaMask on Arbitrum Sepolia

## Script

### 0:00–0:40 — Hook
> “Arb Guardian stops unsafe treasury transactions before execution on Arbitrum — with deterministic evidence and policy-bounded agent playbooks, not opaque AI.”

Show logo + live URL + Arbitrum Sepolia chip.

### 0:40–1:40 — Problem + PMF
> “DAO and startup treasuries still lose funds to bad approvals and weak operational controls. We built the ops console treasuries actually use: policy → assess → block → incident → mitigate.”

Show Overview KPIs + policy controls + Safe path callout.

### 1:40–3:10 — Smart contracts (qualification)
Open Arbiscan:
- PolicyManager address
- ExecutionGuard address
- SafeTreasuryGuard address
- Deploy transaction hashes

> “Deployed on Arbitrum Sepolia. PolicyManager holds allowlists and daily limits with RBAC and pause. ExecutionGuard records and reverts violations. SafeTreasuryGuard is a Gnosis Safe ITransactionGuard — the production multisig integration path.”

### 3:10–4:40 — Live product flow
1. Go to Assess → Risky approval → Run risk assessment
2. Show rule IDs + blocked + playbook
3. Show ExecutionGuard prediction (Would revert)
4. Go to Incidents → Acknowledge → Mitigate
5. Show audit trail

### 4:40–5:40 — Agentic differentiation
Open Agent tab.

> “Our agent is deliberately bounded. Score maps to playbooks. Critical freeze can pause PolicyManager only after a human clicks Mitigate. Eval harness: 12 scenarios, accuracy 1.0.”

### 5:40–6:30 — Close
> “Live product, public repo, onchain proof, Safe-ready guardrails. Built for Arbitrum Open House — Overall and Best Agentic.”

End on README architecture diagram + live URL.

## Upload
- YouTube unlisted or Loom
- Paste URL into HackQuest submission + `SUBMISSION_DEMO_URL` in `.env`
