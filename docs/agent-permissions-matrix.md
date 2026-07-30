# Agent Permissions Matrix

Bounded agentic actions only. No free-form tool use.

| Playbook | Trigger score | Auto-execute? | Onchain action | Human gate |
| --- | --- | ---: | --- | --- |
| `allow-with-monitoring` | 0–29 | No | None | N/A |
| `request-secondary-signer-confirmation` | 30–59 | No | None | Operator ack |
| `hold-transaction-and-require-admin-review` | 60–79 | Soft | Incident hold only | Mitigate / ignore |
| `freeze-wallet-and-revoke-approvals` | ≥80 | Yes on mitigate | `PolicyManager.pause()` | Operator clicks Mitigate |

## Hard bounds

- Agent **cannot** move funds, change allowlists, or transfer admin roles.
- Agent **can** recommend playbooks and, after operator mitigate on critical incidents, pause policy manager.
- Onchain `ExecutionGuard.validateAndRecord` is the source of truth for block/allow.
- Event sync (`POST /chain/sync-events`) imports blocked `TransactionValidated` events into incidents.

## Eval harness

```bash
npm run eval:agent -w apps/api
```

Current coverage: 12 scenarios, target accuracy 1.0.
