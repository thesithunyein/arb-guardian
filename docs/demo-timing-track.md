# 3-Minute Demo Timing Track

## 0:00 - 0:20 Problem and stakes
- Explain treasury loss risk from unsafe approvals and weak execution controls.
- Position Arb Guardian as preventive infrastructure for Arbitrum teams.

## 0:20 - 0:50 Policy setup
- Show policy admin setting allowlisted destination and wallet daily limit.
- Mention RBAC and emergency pause controls briefly.

## 0:50 - 1:30 Risk assessment and block
- Trigger risky transaction (`approve`, non-allowlisted destination, limit breach).
- Show blocked status, score, rule IDs, and reasons in the dashboard.

## 1:30 - 2:10 Incident and action workflow
- Show auto-generated incident with recommended playbook.
- Execute incident action (`mitigate`) and show status update.
- Show audit trail entry with actor and timestamp.

## 2:10 - 2:40 Product metrics and agent evaluation
- Show KPI section: blocked rate, critical incidents, avg risk score.
- Show agent evaluation summary (`accuracy`, `blockedPrecision`, `blockedRecall`).

## 2:40 - 3:00 Chain readiness and close
- Show contract test quality signal and deployment command path.
- End with deploy target and roadmap for production teams.
