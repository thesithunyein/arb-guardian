# Internal security review — enforcement path

**This is an internal review by the authors of this repository.** It is not an independent audit, it
was not written by a third party, and it should not be described as one. It exists because "no
external review yet" was the weakest line in the submission, and because writing down what the guard
does *not* cover is more useful to a reviewer than another page of what it does.

Code references are `file:line` at the commit that adds this file. Dates: reviewed 2026-10-02,
against the deployments listed in `docs/live-deployment.md` (both lanes declared `current`).

## Scope

The on-chain enforcement path only: `PolicyManager`, `SafeTreasuryGuard`, `ExecutionGuard`, the token
calldata decoder, and the flow that installs the guard inside a real Gnosis Safe v1.4.1. The web app
and the serverless API were considered only where they touch the enforcement boundary — the API's
risk engine is advisory and the review says so below.

## Method

- Reading the four contracts and the guard's `checkTransaction` / `checkAfterExecution` path.
- The 69 contract tests, including `RealSafeGuard.test.ts`, which installs the guard through the
  Safe's own `execTransaction` rather than by calling `setGuard` directly.
- The 15-case guard proof (`npm run evidence -w packages/contracts`), which prints a revert reason per
  refusal and pairs each refusal with the same payment settling before installation.
- The live freeze drill (`npm run drill:incident:sepolia`), which exercised `PolicyManagerPaused()`
  against the deployed lane and read `paused()` back from the chain afterwards.
- Direct `eth_call` reads of the deployed `PolicyManager`s: registration, caps, allowlist state, and
  pause state on both lanes.

## Findings

| ID | Severity | Finding | Evidence | Mitigation | Residual risk |
| --- | --- | --- | --- | --- | --- |
| F1 | High | One key holds both `DEFAULT_ADMIN_ROLE` and `POLICY_ADMIN_ROLE`, so it can rewrite allowlists and caps and can unpause. | `PolicyManager.sol:110-111` | None on-chain. Operational only. | A single compromised admin key can widen policy to whatever it likes. This is the largest unresolved risk in the design. |
| F2 | High, mitigated | The guard cannot prevent its own removal. An owner-approved Safe self-call can call `setGuard(address(0))`, and a self-call is deliberately exempt from destination policy. | `SafeTreasuryGuard.sol:166-171`; install path in `scripts/enroll-real-safe.ts` | Removal requires a threshold of Safe owners to approve a real transaction, and it appears on chain like any other. Use threshold > 1 and monitor `SafeTxChecked` and `ChangedGuard` events. | To an observer, removing the guard and a legitimate configuration change look identical until the calldata is read. |
| F3 | Medium | The daily window is a UTC day (`block.timestamp / 1 days`), not a rolling 24 hours, so up to twice a cap can be spent across a 00:00 UTC boundary. | `SafeTreasuryGuard.sol:325,334` | Documented rather than fixed: a rolling window costs a second storage word per wallet and per token. | Quoted caps should be read as per-UTC-day. Do not describe them as "per 24 hours". |
| F4 | Medium | If a destination is not a *registered* token, the guard enforces allowlisting only. Calldata is not policy-checked on that path, so an allowlisted contract can be called arbitrarily, with no cap. | `SafeTreasuryGuard.sol:172-176` | Register token contracts instead of allowlisting them as counterparties; keep the allowlist to payment destinations rather than general-purpose contracts. | The allowlist is the trust boundary. Allowlisting a composable contract widens the blast radius beyond a payment. |
| F5 | Medium | Standing approvals are refused outright, even a small bounded one, because an approval is exercisable later by the spender and would sit outside cap accounting. | `SafeTreasuryGuard.sol:250-268` | Intentional. The refusal is a stated product limitation. | A team whose workflow needs token approvals cannot run that workflow inside the lane. This is a feature gap, not a vulnerability. |
| F6 | Low | The API and `ExecutionGuard` path is advisory. `ExecutionGuard` holds no funds and cannot stop a transfer. | `README.md`, `docs/how-it-works.md` | Stated on the Evidence screen and in the README. | A reader could mistake the console for the enforcement. Only the Safe path enforces, and it is the only one demonstrated with a refused transaction. |
| F7 | Informational | No upgradeability: no proxy, `policyManager` is `immutable` in both guards. | `SafeTreasuryGuard.sol:39`, `ExecutionGuard.sol:25` | Intentional. | A defect in policy logic cannot be patched in place; it requires deploying a new guard and an owner-approved self-call to install it. No proxy admin exists to compromise. |
| F8 | Informational | Before 2026-10-02 the freeze path had never been executed against a deployment, and the first drill run exposed an operational bug: ethers throws on a status-0 receipt, so a script that treats the expected refusal as an error ends early at exactly the step it was proving. | `docs/incident-drill.md` | Drill run and recorded; `waitAllowingRevert()` handles the receipt. | Scripts that assume a refusal returns rather than throws will misreport the same way elsewhere. |

## What a third party should verify first

1. **F1 and F2 together**: whether the deployed admin key and Safe owner set are structured so that no
   single key can both rewrite policy and remove the guard.
2. **The self-call exemption** in `checkTransaction`: confirm that the only owner-approved self-call
   the product needs is guard installation, and that nothing else depends on it.
3. **Token calldata decoding** (`libraries/TokenCalldata.sol`): whether the transfer/approval selector
   sets cover the tokens a pilot actually uses, and how a non-standard token behaves at the
   `transferFrom` source check.
4. **Refund accounting** (`checkAfterExecution`): that a failed inner call can only ever return budget,
   never create it — the code takes the minimum of the pending amount and the recorded spend.
5. **The decimals assumption** in the lane: every cap in this project is quoted in token base units,
   and `docs/live-deployment.md` records the 18-vs-6 trap that a wei-sized number creates.

## Not covered here

No formal verification, no dedicated fuzzing campaign beyond the seeded invariant tests, no economic
or gas-griefing analysis, no review of the web client or the durable KV layer beyond their effect on
the enforcement boundary, and no assessment of deployment key management. Those are the reasons an
external review is still worth commissioning, and this file should be replaced by one rather than
quoted in its place.
