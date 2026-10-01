# Security

What this system enforces, what it does not, and the defects that have been found and fixed. Written
to be read adversarially: the limits below are the ones a reviewer should push on.

Audit status: **not audited by a third party.** Nothing here is a substitute for one.

## What the guard actually does

`SafeTreasuryGuard` is a real Gnosis Safe v1.4.1 transaction guard. Once installed via
`GuardManager.setGuard` — which Safe only permits through an owner-approved `execTransaction` calling
the Safe itself — every transaction the Safe executes passes through `checkTransaction` first, and a
policy-violating transaction reverts inside the Safe's own `execTransaction`. That is the enforced
path, and `packages/contracts/test/RealSafeGuard.test.ts` plus the evidence pack exercise it against
the real Safe contracts, not a shell.

`ExecutionGuard` is different, and the difference matters. It holds no funds and cannot move any. Its
`validateAndRecord` is a **pre-execution check that a cooperating caller must choose to call** — the
API, an operator bot, a relayer. For a treasury held in a bare EOA, nothing forces that call. The
bound is real only where a guard is installed and the funds sit behind it. Read the deployed
`ExecutionGuard` as instrumentation and a shared enforcement point for cooperators, never as a
custody-level guarantee on its own.

## Trust assumptions

| Assumption | Consequence if it fails |
| --- | --- |
| A single admin EOA holds `DEFAULT_ADMIN_ROLE`, `POLICY_ADMIN_ROLE` and `OPERATOR_ROLE` at deploy | That key can allowlist any address, raise any cap, or freeze the policy. There is no multisig requirement and no timelock in the contracts |
| The admin allowlists honestly | An allowlisted address can drain up to the cap. The allowlist is a manual, off-chain judgement and the contracts cannot tell a vendor from a drainer |
| Guards are installed where the money is | Where no guard is installed, the policy is advice. See "What the guard actually does" |
| The policy admin is not also the party being constrained | The same key that grants a spending lane can widen it. Separation is an operational decision, not a contract-enforced one |
| USDG's decimals are 6 | Every token cap is in base units. `npm run check:settlement` reads `decimals()` from the token itself so this is checked rather than assumed |
| The chain's block clock is honest | Daily windows derive from `block.timestamp` |

## Deliberate limits (not defects)

These are choices with real costs, stated so they are not mistaken for oversights.

**Daily windows are UTC-day, not rolling 24 hours.** `_resetDailySpendIfNeeded` compares
`block.timestamp / 1 days`. A wallet can therefore move the full cap once before a UTC midnight and
again immediately after — twice the intended ceiling inside a few minutes. A rolling window needs
per-spend timestamps or a bucketed ring, which costs storage and gas on every spend. This is a known
trade; a treasury that cares should size the cap with the boundary in mind.

**Approvals are bounded by the allowlist, not by a number.** `validateTokenApproval` refuses exactly
`type(uint256).max` and otherwise records nothing against the daily cap, because an approval grants
standing authority rather than moving funds. So an approval of `type(uint256).max - 1` is granted,
and approvals do not consume the transfer budget. The only real bound is which spender has been
allowlisted for that token. This is pinned by test so that changing it is a deliberate act:
`refuses an unlimited approval under every policy setting, and pins what a bounded one grants`
(`test/Invariants.test.ts`). The obvious hardening is a per-token approval ceiling.

**No proxy, no upgrade path.** Contracts are deployed directly and are not upgradeable. A fix means a
new deployment and repointing the app and the Safe's guard. That is a deliberate choice against
mutable enforcement, and it is why the repository ships a bytecode drift check instead of claiming the
deployed addresses are current.

## Defects found and fixed

Recorded because a system that has never had a bug found is one whose bugs have not been looked for.
The first two were found while reading the deployed bytecode against the source; the third while
building this product's own preflight.

| Defect | Effect | Fix |
| --- | --- | --- |
| The daily limit failed open (`if (dailyLimit > 0 && projected > limit)`) | A limit of `0` — an unconfigured wallet, or one whose cap had just been cleared — meant **unlimited**. The strongest-looking setting was the weakest | Deny-by-default: `0` blocks all spending; uncapped requires the explicit `UNLIMITED_LIMIT` sentinel |
| The approval rule could not block | `approve` scored `+20` against a `60` threshold, so an approval to an allowlisted destination always passed. Unlimited approvals — the standard drain primitive — were unrestricted | Approval-class calls block by default, matched by method name *and* 4-byte selector; `type(uint256).max` is refused outright |
| The assessor ignored a frozen policy | `assessTransaction` scored a spend as *allowed* while `ExecutionGuard` was certain to revert `PolicyManagerPaused` — the product blessing what the chain would refuse | The pause is now a blocking rule in both engines, with a regression test |
| Enrollment rejected every new operator | The signed message was reworded but the server still checked the old prefix, so all enrollments returned `400` | Both prefixes accepted |
| `/api/treasurys` did not exist | The handler had been renamed; the dev server answered with the SPA fallback, so it looked fine locally and 404'd only in production | Route renamed and `npm run check:routes` added to CI to catch the next one |
| A local deploy record shadowed the real deployment | A throwaway Hardhat chain (id 31337) became "the" deployment for the API, so live checks **skipped** — a skip that reads exactly like a pass | A record for a non-real chain can no longer win; pinned by `apps/api/src/deploymentStatus.test.ts` |
| `verify.ts` reported success when verification failed | The exit code was 1 but the closing line read "Done. Open the explorer and confirm each contract shows a verified source." | Failures are collected and reported as the last, loudest line |

## How the claims in this repository are checked

The recurring failure mode in a project like this is a README that confidently describes a system the
deployed bytecode does not implement. Four separate mechanisms exist so that the prose cannot drift:

- `npm run test -w packages/contracts` — unit tests, plus `test/Invariants.test.ts`, which drives
  pseudo-random spend sequences and asserts the ceiling holds after every step.
- `npm run evidence -w packages/contracts` — deploys a real Safe, installs the guard, and records
  allowed/blocked outcomes with revert reasons. Exits non-zero if any case misbehaves.
- `npm run check:deployed` — reads the bytecode at every live address and fails when the declared
  status disagrees with the chain.
- `npm run check:settlement` — reads `symbol()` and `decimals()` at the declared USDG address on each
  lane, because a lane configured at the wrong scale misreads every cap by a power of ten.

## Reporting

Open an issue at https://github.com/thesithunyein/arb-guardian/issues. This is a testnet-stage project
with no funds at risk; there is no bounty programme, and the honest answer is that you should not put
meaningful value behind it yet.
