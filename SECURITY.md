# Security policy

## Supported status

Arb Guardian is an early-stage testnet project. The public web app is live, but the recorded
contract deployments are marked **superseded** and should not be used as current treasury
enforcement. There is no claim of mainnet safety or independent audit.

## Reporting a vulnerability

Do not disclose a suspected vulnerability in a public issue, pull request, chat, or submission.
Use GitHub's private security advisory flow for this repository. If that is unavailable, contact the
repository maintainer privately through the GitHub profile for
[`thesithunyein/arb-guardian`](https://github.com/thesithunyein/arb-guardian).

Include:

- affected component and commit or deployment;
- a concise impact statement;
- reproducible steps or a minimal proof of concept;
- whether funds, credentials, or personal data may be at risk;
- a safe contact method for follow-up.

Please redact private keys, API keys, seed phrases, personal data, and live user information.
Do not test against a third-party treasury or attempt to move funds.

## Disclosure expectations

Maintainers will acknowledge a report when practicable, investigate its impact, and coordinate a
fix or mitigation before public disclosure. Timelines depend on severity and whether a live
deployment is affected. Researchers will be credited when they request it and when doing so does
not create additional risk.

## Security boundaries

- `ExecutionGuard` is not a custody contract and cannot stop an operator who bypasses it.
- Hard enforcement requires a correctly installed `SafeTreasuryGuard` on the actual Safe.
- Deployment addresses are not current unless source and bytecode are explorer-verified against this
  repository.
- USDG is not active unless its real address and treasury configuration are supplied and verified.
- Never place secrets in git, browser bundles, logs, screenshots, or evidence artifacts.
