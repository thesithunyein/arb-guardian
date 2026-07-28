# Architecture

## Components

- **PolicyManager (Solidity):** source of truth for allowlists and wallet limits.
- **ExecutionGuard (Solidity):** validates transaction intents and records spend.
- **API risk engine (TypeScript):** deterministic transaction scoring.
- **Agent coordinator (TypeScript):** maps risk evidence to mitigation playbooks.
- **Web dashboard (React):** operator interface for assessment and incident review.

## Data flow

1. Operator submits transaction intent.
2. API evaluates deterministic rules and computes risk score.
3. If blocked, incident is created with machine-verifiable evidence.
4. Operator reviews playbook recommendation and executes allowed response.
5. Onchain contracts emit audit events for policy and validation actions.
