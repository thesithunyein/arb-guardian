# Scope Lock: Arb Guardian MVP

## Primary user persona

**Name:** Treasury Signer Lead  
**Organization:** Early-stage DAO or onchain startup  
**Pain points:**
- Cannot consistently enforce treasury transaction policy across signers
- Limited visibility into risky counterparties and approval patterns
- Slow incident response when suspicious activity appears

## Three critical workflows

1. **Policy authoring and enforcement**
   - Admin defines allowlisted counterparties, transfer ceilings, and asset-specific limits.
   - Guard contract blocks disallowed transactions before execution.

2. **Pre-execution risk review**
   - Risk engine evaluates an intended transaction against deterministic rules.
   - Operator sees rule matches, score, and exact violation reason before confirming.

3. **Incident detection and mitigation**
   - Event monitor detects policy breaches or suspicious allowance changes.
   - Agent coordinator recommends mitigation playbook and executes only if policy permits.

## MVP boundaries

- Include: Arbitrum Sepolia deployment, role-based policy controls, incident timeline, playbook execution audit.
- Exclude: multi-chain support, probabilistic ML scoring, social feed, tokenomics.

## Demo success metrics

- **Policy efficacy:** block at least 2 unsafe transaction attempts in demo.
- **Response speed:** detect and surface incident within 10 seconds of event ingestion.
- **Actionability:** each incident includes rule evidence and one executable mitigation action.
- **Reliability:** 100% pass on contract unit tests and backend risk rule tests in CI.
