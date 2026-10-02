# How Arb Guardian works

Arb Guardian is treasury control software.

It helps a team give limited spending access to an agent, bot, or operator.

## The flow

1. **Set policy**

   Add trusted payees. Set asset and daily limits.

2. **Review requests**

   Check the amount, payee, asset, and remaining budget.

3. **Enforce the rule**

   SafeTreasuryGuard blocks requests that break policy.

4. **Respond to alerts**

   Operators can review, acknowledge, or freeze the treasury.

## Who it is for

- DAO treasury teams
- Onchain companies
- Grant and payroll operators
- Market makers
- Teams running automated agents

## What it does not do

- It does not custody funds.
- It does not replace Safe signers.
- It does not make trading decisions.
- It does not promise that every risk can be detected.

## Current deployment status

The public app is live, and `/api/status` reports `productReady: true` against a deployment
declared `current`. Both lanes carry the corrected build (2026-10-02): a real Gnosis Safe on each
holds the guard, installed through the Safe's own `execTransaction`, with an allowed spend and a
refused spend both onchain. The Robinhood lane is source-verified on its explorer; the Arbitrum
Sepolia lane is byte-matched to this source but still needs an Arbiscan key to publish its source
panel.
