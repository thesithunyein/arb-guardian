# Arb Guardian FAQ

## What problem does it solve?

Shared treasury access is hard to control.
One bad transfer can drain a wallet.
Arb Guardian adds limits before a Safe transaction executes.

## Who should use it?

Use it if your team has a treasury and more than one person or process can request spending.
It is useful for DAOs, protocols, grants, payroll, and automated operations.

## Is this an AI product?

No.
The core policy path is deterministic.
This keeps the enforcement rule clear and auditable.

## Does it work with Gnosis Safe?

Yes.
The SafeTreasuryGuard contract is built for the Safe transaction guard interface.

## Does it custody funds?

No.
Funds remain in the treasury Safe.

## What is live today?

The web app and API are live.
The current public contract records are older testnet deployments.
They are not presented as the corrected build.

## What is needed before production use?

Deploy the corrected contracts.
Verify their source.
Install the guard on the team Safe.
Run a small test transfer.
Then add more assets and limits.

## Is there a real market?

Yes, but the first market is focused.
Teams with shared onchain funds have a clear control problem.
The product must prove lower signing risk, fast setup, and reliable Safe integration.
