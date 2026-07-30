# Demo Video Script (5–7 min) — Judge Recording

Record this once and submit the URL on HackQuest.

## Setup (before record)
1. Open https://arb-guardian.vercel.app (dark mode)
2. Open Arbiscan tabs:
   - PolicyManager
   - SafeTreasuryGuard
   - Enrolled Treasury Safe
   - Allowed Safe exec tx
3. Optional: MetaMask on Arbitrum Sepolia
4. If PolicyManager is paused from a prior dry-run, click **Unpause PolicyManager** on Incidents

## Script

### 0:00–0:40 — Hook
> “Arb Guardian stops unsafe treasury transactions before execution on Arbitrum — with deterministic evidence, an enrolled Safe guard path, and policy-bounded agent playbooks.”

Show logo + live URL + Arbitrum Sepolia chip.

### 0:40–1:30 — Problem + PMF
> “DAO treasuries lose funds to bad approvals and weak ops. We built the console they use: policy → assess → block → incident → onchain mitigate.”

Show Overview KPIs + enrolled Treasury Safe address.

### 1:30–3:00 — Smart contracts (qualification)
Open Arbiscan for PolicyManager, SafeTreasuryGuard, enrolled Safe, setGuard + enrollment + allowed exec txs.

> “Deployed on Arbitrum Sepolia. PolicyManager holds allowlists and limits. SafeTreasuryGuard is an ITransactionGuard. Our enrolled treasury Safe already proved allow and block onchain.”

### 3:00–4:40 — Live product flow
1. Assess → Risky approval → Run risk assessment
2. Show rule IDs + blocked + playbook `freeze-wallet-and-revoke-approvals`
3. Incidents → Mitigate
4. Show **onchain pause tx** link in Audit trail
5. Optional: Unpause for clean close

### 4:40–5:40 — Agentic differentiation
Open Agent tab → show live eval accuracy 1.0 from `/api/agent/eval`.

> “Agent is bounded. Score maps to playbooks. Critical freeze pauses PolicyManager only after a human clicks Mitigate.”

### 5:40–6:30 — Close
> “Live product, public repo, enrolled Safe proof, onchain mitigate. Built for Arbitrum Open House — Overall and Best Agentic.”

## Upload
- YouTube unlisted or Loom
- Paste URL into HackQuest + `SUBMISSION_DEMO_URL`
