# Arb Guardian — Guard Proof

Generated 2026-10-01T06:05:21.381Z by `npm run evidence -w packages/contracts` on the in-process `hardhat` chain.

This is a reproduction, not a recording. Every row below was produced by executing the transaction against a **real Gnosis Safe v1.4.1** (real singleton, real proxy factory, real fallback handler) with `SafeTreasuryGuard` installed as its guard.

## How to reproduce

```bash
git clone https://github.com/thesithunyein/arb-guardian
cd arb-guardian && npm install
npm run evidence -w packages/contracts
```

The script exits non-zero if any case does not behave as expected, so the table below cannot silently drift from the contracts.

## Result: 15/15 cases behaved as specified

| # | Case | Expected | Observed | Revert reason |
| ---: | --- | --- | --- | --- |
| 1 | Before the guard is installed, the Safe pays a NON-allowlisted address 1.0 ETH and the transfer settles. | allowed | allowed | `—` |
| 2 | After the guard is installed, the same non-allowlisted payment is refused before it executes. | blocked | blocked | `CounterpartyNotAllowlisted("0x90F79bf6EB2c4f870365E785982E1f101E93b906")` |
| 3 | A payment to an allowlisted vendor above the 5 ETH daily cap is refused. | blocked | blocked | `DailyLimitExceeded("0x294c20f3071BA768b9BC9dbfb508AD7130a598E1", 6000000000000000000, 5000000000000000000)` |
| 4 | A payment to an allowlisted vendor inside the cap is allowed. | allowed | allowed | `—` |
| 5 | The Safe pays an allowlisted recipient 1,200 USDG, inside the 5,000 USDG daily cap. | allowed | allowed | `—` |
| 6 | The Safe attempts a 6,000 USDG payment, above the 5,000 USDG daily cap. | blocked | blocked | `TokenDailyLimitExceeded("0x0165878A594ca255338adfa4d48449f69242Eb8F", "0x294c20f3071BA768b9BC9dbfb508AD7130a598E1", 7200000000, 5000000000)` |
| 7 | The Safe attempts to pay a recipient that is not allowlisted for USDG. | blocked | blocked | `TokenCounterpartyNotAllowlisted("0x0165878A594ca255338adfa4d48449f69242Eb8F", "0x90F79bf6EB2c4f870365E785982E1f101E93b906")` |
| 8 | The Safe grants a bounded 250 USDG approval to an allowlisted spender. | allowed | allowed | `—` |
| 9 | The Safe attempts an unlimited USDG approval — the classic drain primitive. | blocked | blocked | `UnlimitedApprovalNotAllowed("0x0165878A594ca255338adfa4d48449f69242Eb8F", "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc")` |
| 10 | The Safe attempts a non-standard call on a registered token instead of falling through. | blocked | blocked | `UnsupportedTokenCall("0x0165878A594ca255338adfa4d48449f69242Eb8F", "0x40c10f19")` |
| 11 | The Safe attempts a delegatecall, which a guard must never permit. | blocked | blocked | `DelegateCallNotAllowed()` |
| 12 | After an officer freeze, an otherwise valid allowlisted payment is refused. | blocked | blocked | `PolicyManagerPaused()` |
| 13 | Clearing the USDG cap to zero does not open the lane — it fails closed. | blocked | blocked | `TokenDailyLimitNotConfigured("0x0165878A594ca255338adfa4d48449f69242Eb8F", "0x294c20f3071BA768b9BC9dbfb508AD7130a598E1")` |
| 14 | An owner calling setGuard directly (not through the Safe) is rejected by Safe 1.4.1. | blocked | blocked | `GS031` |
| 15 | After the native cap is raised from 5 ETH to 6 ETH, the vendor payment is allowed again and is stamped with the NEW policy version. | allowed | allowed | `—` |

## Addresses used in this run

| Contract | Address |
| --- | --- |
| Gnosis Safe v1.4.1 (proxy) | `0x294c20f3071BA768b9BC9dbfb508AD7130a598E1` |
| PolicyManager | `0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9` |
| SafeTreasuryGuard | `0x5FC8d32690cc91D4c39d9d3abcBD16989F875707` |
| USDG-shaped test token (6 dp) | `0x0165878A594ca255338adfa4d48449f69242Eb8F` |

## Policy attestation

A decision is only meaningful against the policy that was in force at the time. So every policy mutation advances a hash-chained version — `digest[n] = keccak256(prev, n, kind, params)` — and each allowed decision record carries the version and digest that judged it.

| Field | Value |
| --- | --- |
| Genesis seed | `0x61e7819e82690c034d1b6f89cc55ff695755fefcfaf7904ab0146803747fdea6` |
| Amendments replayed from logs | 11 |
| Head policy version | 10 |
| Head policy digest | `0xcd06814a704c76943b5f0f691587c7a137ee2697f0b3883f8132370c55b2e290` |
| Digest chain replay | 11/11 digests recomputed from logs |
| Allowed decisions stamped | 6/6 match a version in the amendment log |
| Distinct policy versions across decisions | 2 (proves the stamp tracks amendments, not a constant) |

| Decision | Policy version | Digest in force |
| --- | ---: | --- |
| `allowed` | 6 | `0x3442214ee3c7f11e…` |
| `allowed` | 6 | `0x3442214ee3c7f11e…` |
| `allowed` | 6 | `0x3442214ee3c7f11e…` |
| `allowed` | 10 | `0xcd06814a704c7694…` |
| `allowed` | 6 | `0x3442214ee3c7f11e…` |
| `approval_allowed` | 6 | `0x3442214ee3c7f11e…` |

Blocked decisions revert, so they leave no logs of their own — they are attributed to the policy version in force at their block, which the amendment log pins down. The stamp is what makes an executed transfer reconcilable after the fact.

## Why the first row matters

Row 1 is the same payment as row 2, executed **before** the guard was installed. It settles. Row 2 is refused. A screenshot of a blocked transaction proves nothing on its own; the before/after pair is what shows the guard is the thing making the difference.

The guard is installed the only way Safe 1.4.1 permits: `GuardManager.setGuard` is `SelfAuthorized`, so it must arrive as an owner-approved `execTransaction` that calls the Safe itself. The final row confirms a direct call from an owner is rejected.

## Live testnet deployments

Addresses for Arbitrum Sepolia and Robinhood Chain Testnet: [`docs/live-deployment.md`](../../docs/live-deployment.md).
