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
evidence pack executes 14 cases and records the exact revert reason for each. It includes a
**before/after pair**: the same non-allowlisted payment settles before the guard is installed and
is refused after, which is what shows the guard is making the difference.

The generator exits non-zero if any case drifts, so the table cannot silently go stale.
Artifacts: `packages/contracts/evidence/guard-proof.md` and `guard-proof.json`.

Test totals should be regenerated with `npm run quality:gate` before submission; this branch adds
coverage for finite-approval and `transferFrom` bypass attempts.

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

- Web app: https://arb-guardian.vercel.app
- Repo: https://github.com/thesithunyein/arb-guardian
- Guard proof: `packages/contracts/evidence/guard-proof.md`
- Demo video: **not recorded**

## Contract addresses

### Live now (deployed 2026-07-30) — **superseded, see note**

**Arbitrum Sepolia** (chain 421614)
- PolicyManager: `0x4f3dC29Ed0c8844E31fD84c3eE22C1C94158Cf76`
- ExecutionGuard: `0x10fbe21ccb611A2aBF12a784C67278eAf6dE6124`
- SafeTreasuryGuard: `0xcba30F60BE3FB0fB0e9db0C816c4ab9Fa2f7b211`
- Enrolled treasury: `0x009D53F97a07d9E141eA5ff90354d7bE748fa542`

**Robinhood Chain Testnet** (chain 46630)
- PolicyManager: `0x57077DA6DEFCAAB83aEAbE080641D5D1Ed66758F`
- ExecutionGuard: `0x4019C445bbc593eA5eb13D319Ca427aA8aDc7613`
- SafeTreasuryGuard: `0xa168227dB7a3340e988Dbf9Cd01894840617E729`
- Enrolled treasury: `0x10fbe21ccb611A2aBF12a784C67278eAf6dE6124`

> **Important.** Those addresses implement the earlier semantics: the daily limit **failed open**
> (a limit of `0` meant *unlimited*) and the approval rule could not block. The contracts in this
> repository now fail closed and enforce the token lane. **Redeploy and re-verify before
> submitting, and update this section with the new addresses and transaction hashes.** Do not
> present the addresses above as the fixed build.
>
> Note also that the Robinhood enrolled-treasury address resembles the Arbitrum ExecutionGuard
> address. They are unrelated — separate chains, independent address spaces, different code.

## Deployment transactions

- Corrected-build deployment transactions: **not available; deployment is blocked pending
  funded keys and operator approval. Do not fabricate hashes.**

## What we validated

- Contract test suite covers real Gnosis Safe v1.4.1 integration, token caps, approval refusal,
  and Safe-source `transferFrom`; rerun `npm run test -w packages/contracts` after installing
  dependencies in a networked environment.
- 17 API unit/integration tests pass (`npm run test -w apps/api`)
- 14 policy-conformance fixtures pass (`npm run eval:policy -w apps/api`) — a regression suite
  over fixed cases, **not** model validation
- Guard proof regenerates 15/15 (`npm run evidence -w packages/contracts`)
- Production builds pass for API and web
