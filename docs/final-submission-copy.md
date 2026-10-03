# Final Submission Copy (HackQuest)

## Project name

Arb Guardian

## One-sentence summary

Arb Guardian is an on-chain spend-policy layer that lets a treasury delegate funds to an AI
agent, bot or operator **without** delegating the ability to drain the account: limits and
allowlists are enforced by a real Gnosis Safe transaction guard, in native ETH and in USDG, and
any third party can verify every refusal on a public ledger.

## Problem

Delegating money on-chain is all-or-nothing. The moment a treasury lets an agent, keeper bot or
junior operator move funds, it grants the ability to move *all* of them. Every control available
today is either **static** ("fund a separate account and hope") or **manual** ("approve each
transaction") — and manual approval defeats the point of automation.

The gap is not detection. It is **enforceable bounds**: a ceiling the delegate cannot exceed, that
does not depend on the delegate's prompt, a vendor's custody arrangement, or an off-chain API it
can route around.

Concrete, cited stakes on Robinhood Chain: one crew ran 56 token launches between July 10 and
September 23, 2026 for a net take of roughly **$15.5M**, with buyers losing **$13.3M** — of which
**$9.4M** came from users buying inside consumer apps who never saw an on-chain flag (Bitquery
on-chain investigation, published September 28, 2026; analyst Wazz, covered by The Block).
Separately, Robinhood has opened agentic trading to all customers and is rolling out agentic
accounts to the mainstream, with continuous execution on the roadmap. You cannot have continuous
autonomous trading *and* per-trade human approval, which is precisely the gap a contract-enforced
policy fills.

## Solution

Three contracts plus an operator console.

- **Deny-by-default limits.** An unconfigured wallet or Safe cannot spend at all. Uncapped
  spending requires an explicit `UNLIMITED_LIMIT` grant, so a missing configuration fails closed
  rather than open.
- **A token lane, not just native ETH.** Register an ERC-20 (USDG first), allowlist its
  counterparties, and cap it per wallet per day in the token's own base units. USDG uses 6
  decimals, so a $5,000 cap is `5_000 * 10**6` — a wei-denominated policy would have allowed a
  million times the intended amount, and there is a test for exactly that mistake.
- **Standing approvals are refused at the enforcement boundary.** A finite approval is not safe
  merely because it is below today's cap: the spender can later call `transferFrom` without the
  Safe guard seeing a new Safe transaction. The contracts therefore reject approvals and require
  direct, cap-accounted transfers; `transferFrom` must also name the guarded Safe as its source.
- **Real Safe enforcement.** `SafeTreasuryGuard` is a Gnosis Safe v1.4.1 `ITransactionGuard`,
  installed the only way Safe permits (`GuardManager.setGuard` is `SelfAuthorized`, so it must
  arrive as an owner-approved `execTransaction` self-call). Once installed, a policy-violating
  transaction reverts inside the Safe's own `execTransaction`.
- **Calldata-aware routing.** A registered token's calldata is decoded; an unrecognised call on a
  registered token is rejected rather than silently falling through to the native lane.
- **Spend recorded before execution, refunded after failure.** No re-entrancy bypass, and a failed
  inner call does not silently consume the day's budget.
- **Deterministic operator console.** Risk scoring, alerts, playbook recommendations and an audit
  trail. No model, no LLM call — a deterministic engine cannot be prompt-injected.
- **Human circuit breaker.** `PolicyManager.pause()` freezes all spending and requires an explicit
  operator action in Alerts.

## Proof, not a demo

A reproduction, not a recording:

```bash
npm run evidence -w packages/contracts   # → 15/15 cases behaved as specified
```

`packages/contracts/test/RealSafeGuard.test.ts` drives a **real Gnosis Safe v1.4.1** — real
singleton, proxy factory and fallback handler, not a bespoke "Safe-compatible" shell. The
evidence pack executes 15 cases and records the exact revert reason for each. It includes a
**before/after pair**: the same non-allowlisted payment settles before the guard is installed and
is refused after, which is what shows the guard is making the difference.

The generator exits non-zero if any case drifts, so the table cannot silently go stale.
Artifacts: `packages/contracts/evidence/guard-proof.md` and `guard-proof.json`.

Measured on this commit: 128 tests across four suites — 69 contract tests, 25 API tests (4 live,
read-only), 20 shared, and 14 for the durable store.

## Why Arbitrum / Robinhood Chain

Because the bound has to hold when the delegate misbehaves. An off-chain API cap is only as good
as the delegate's willingness to call it; a contract-enforced cap holds regardless of what the
agent's prompt says, and any third party can verify it.

A per-transaction policy check must be cheap enough to run on every spend, which means an L2.
Arbitrum is where the mature DeFi and existing Safe tooling live; **Robinhood Chain** is where the
agents and retail users are actually being pointed, and it is where **USDG** — the chain's
natively issued Global Dollar and the lending asset in Robinhood Earn — settles.

## Judging criteria alignment

- **Smart contract quality:** OpenZeppelin `AccessControl` / `Pausable`, custom errors, explicit
  zero-address and amount guards, deny-by-default limits, no re-entrancy path on spend recording,
  a bounds-checked calldata decoding library, and a guard verified against real Gnosis Safe 1.4.1.
- **Product-Market Fit:** the control every team delegating funds needs, in the asset treasuries
  actually hold (stablecoins), on the chains where those teams are being pointed.
- **Innovation and creativity:** trustless, calldata-aware spend policy — including refusal of
  standing approvals and rejection of unrecognised calls on registered tokens — enforced inside a
  real Safe rather than by vendor goodwill or application code.
- **Real problem solving:** addresses a specific, quantified, current failure of delegated trust,
  and ships a reproducible artifact proving the enforcement works.
- **Paxos USDG:** a first-class token lane, denominated correctly in USDG's 6-decimal base units.

## Links

- Web app: https://arb-guardian.sithunyein.com (Vercel alias: https://arb-guardian.vercel.app)
- Production check: both URLs returned HTTP 200; same-origin API health is
  https://arb-guardian.sithunyein.com/api/health
- Repo: https://github.com/thesithunyein/arb-guardian
- Guard proof: `packages/contracts/evidence/guard-proof.md`
- Demo video: **not recorded**

## Contract addresses

### Live now (deployed 2026-10-02) — declared `current`, 6/6 drift claims holding

**Arbitrum Sepolia** (chain 421614)
- PolicyManager: `0x3e394b1d9781a71D71905d028C530B29Aa0021a6`
- ExecutionGuard: `0x5e60F2D4E3F50eA16Ed0413e718535d720c3D5cC`
- SafeTreasuryGuard: `0x01b03b1e0E20F84a9Fa832AbeB58283e30cA2F1b`
- Gnosis Safe v1.4.1 (guard installed through its own `execTransaction`): `0x5769B6973cF7E85acfa7590763549bfCf80Cbb82`
- Allowed spend: `0x1313db311ce1e99b3623c4b42e6d6f1e531f40bc3e7032f88c68a790343ba216`
- Refused spend (status 0, reverted by the guard): `0xff26308871c5b7c36b477940dc1b7307f8fdbbd979190ef89760b86902a99524`

**Robinhood Chain Testnet** (chain 46630)
- PolicyManager: `0x3E4a51B35a984f33D4F71CEf96Eb8f08fcC8Ef2b`
- ExecutionGuard: `0xD1bbF5e71295696B2011408eAa13dEb69adcD21D`
- SafeTreasuryGuard: `0xe10afE3da5546fc0F34c6F38DB3920BD5f5C6999`
- Gnosis Safe v1.4.1: `0x8D9540796444ded4dA17fC0FA38CcBb9a701991a`
- Allowed spend: `0xb7f97778c85b99e3188bdb75258fd351ff873a055896ea4781e1363a7ae643c8`
- Refused spend (status 0, reverted by the guard): `0x44e08cf915f90b7394eb0be18cd10ac44399e2e685f47821ebbd639d1412f515`

> **Verification status.** All six contracts are source-published. Sourcify recompiled the compiler's
> own standard JSON input and reports `exact_match` for both the creation and runtime bytecode of every
> contract on both lanes, and each one reads as verified on its panel on Arbitrum Sepolia Blockscout
> and Robinhood Chain Testnet (`npm run verify:sourcify`, recorded in
> `packages/contracts/evidence/sourcify.json`). Arbiscan's own panel is the one item still open: it
> needs an `ARBISCAN_API_KEY`; the recorder for it is already in place and wired into
> `npm run preflight`, so adding the key is the whole remaining step (`npm run verify:arbiscan`
> submits, waits, reads the result back from Arbiscan, and rewrites `evidence/arbiscan.json`, which
> the site renders). Until that key exists, say "published on Sourcify with a verified Blockscout
> panel", not "verified on Arbiscan".
>
> The 2026-07-30 addresses are superseded: that build failed open on a limit of `0` and its
> approval rule could never block, and it had no token lane or attestation. They are kept for
> history in `docs/live-deployment.md` under `superseded`, and must not be presented as current.

## Deployment transactions

- Corrected-build deployment transactions are live and recorded: PolicyManager
  `0xcf05d7550a84f8f9025d72f1a1ff6a48b56e2f6244e7b28c359b66ec5c8dd02d`, ExecutionGuard
  `0x23f446d300ea4c6cfaf39191d95091ff7be5a06e32c6482354eac3a03b59dd86`, SafeTreasuryGuard
  `0x8cf1615ca6849bfef4fc3b33ba554a28d8cddb8459b25c3191970d579563eff6` (Arbitrum Sepolia), with the
  full set for both lanes in `docs/live-deployment.md`.
- Freeze drill against the live lane: pause tx `0xae409c709726042ad9ba526f276951528b89c095e42673ea2efb29599496e3e0`,
  refusal while frozen `0x11bc033b452358254993cbacee3f146ef9e8823998d37d6177f080f7837e7925` (status 0),
  unpause `0x7d12365ec32fc81d0128b51174432151d11015a04dbc87f8d305cc34d0499ff8`, resumed spend
  `0xdc4b455856bf141b4282c2e20518ba00f95396b7c52b015d0ce16ad06c91a8b9` (status 1).

## What we validated

- Contract test suite covers real Gnosis Safe v1.4.1 integration, token caps, approval refusal,
  and Safe-source `transferFrom`; rerun `npm run test -w packages/contracts` after installing
  dependencies in a networked environment.
- 25 API unit/integration tests pass (`npm run test -w apps/api`), 4 of them live read-only `eth_call`s against the deployed PolicyManager
- 14 policy-conformance fixtures pass (`npm run eval:policy -w apps/api`) — a regression suite
  over fixed cases, **not** model validation
- Guard proof regenerates 15/15 (`npm run evidence -w packages/contracts`)
- Production builds pass for API and web
