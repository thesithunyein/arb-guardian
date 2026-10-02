# Live deployment

Public on-chain qualification proof for Arb Guardian.

## Verification snapshot (2026-10-02)

- Production app: [arb-guardian.sithunyein.com](https://arb-guardian.sithunyein.com) returned HTTP
  200 and resolves to Vercel-managed DNS.
- Vercel alias: [arb-guardian.vercel.app](https://arb-guardian.vercel.app) returned HTTP 200.
- `/api/status` → `chainConnected: true`, `productReady: true`, `deployment.status: "current"`.
- `/api/health` → `persistence: {"durable": true, "backend": "vercel-kv", "reachable": true}`.
- `npm run check:deployed` → 6 contracts read over public RPC, 6 claims held, 0 violated.
- `npm run check:settlement` → `symbol() = USDG`, `decimals() = 6` at both lanes' token addresses.
- Source verification: all six contracts are published. Sourcify reports `exact_match` for both
  creation and runtime bytecode on both lanes, and each contract reads as verified on its own
  explorer panel (Arbitrum Sepolia Blockscout, Robinhood Chain Testnet). Arbiscan's own panel is the
  one open item — that needs `ARBISCAN_API_KEY`. See "Source published" below.
- Freeze drill: refused decision → on-chain pause → the normally-settling spend refused while frozen
  → unpause → the spend settles again, in 33.8 s. Hashes below and in `docs/incident-drill.md`.
- On both lanes an allowed spend settled and a refused spend reverted inside the guard; both have
  transaction hashes (links below).

## What changed from the 2026-07-30 deployment

The addresses deployed on 2026-07-30 ran an earlier build and are **superseded**. They are kept at
the bottom of this file as history, and `packages/contracts/evidence/live-deployments.json` still
holds them under `replaced`. Two correctness changes are why they must not be presented as current:

1. **The daily limit used to fail open.** `if (dailyLimit > 0 && ...)` meant a limit of `0` was
   *unlimited*, so an unconfigured wallet had no protection and clearing a limit opened the lane. It
   now fails closed: `0` blocks all spending, and uncapped spending requires an explicit
   `UNLIMITED_LIMIT`.
2. **The approval rule could not block.** It scored `+20` against a `60` threshold, so `approve` to
   an allowlisted destination always passed. Approval-class calls now block by default, matched by
   name *and* selector, and standing approvals are refused outright.

Neither the token lane (USDG) nor the versioned policy attestation (`policyVersion` /
`policyDigest`, `PolicyAmendment` history) existed in that bytecode. Both are live in the current
deployment.

The current addresses were produced by the checked path and re-checked afterwards:

```bash
npm run deploy:preflight     # keys, balances, faucet names — refuses until every prerequisite holds
npm run deploy:sepolia:full -w packages/contracts
npm run enroll:real-safe:sepolia        # real Safe, guard via the Safe's own execTransaction
npm run deploy:robinhood:full -w packages/contracts
npm run enroll:real-safe:robinhood
npm run repoint              # manifest -> current, app constants rewritten, then proved on-chain
npm run check:deployed       # 6/6 claims, or a non-zero exit
```

`npm run verify -w packages/contracts -- --network robinhoodTestnet` has already been run against
the Robinhood lane; the same command against `arbitrumSepolia` is the outstanding step once an
Arbiscan key is present.

## Source published — what a reader can click

The bytecode match above is a claim only someone willing to run `check:deployed` can check. Source
publication is the clickable version, and it should not depend on a single vendor's API key:

```bash
npm run verify:sourcify            # both lanes; writes evidence/sourcify.json
npm run verify:sourcify -- --network arbitrumSepolia
```

That script submits the compiler's own standard JSON input — read from the build-info that produced
each deployed artifact, not from the working tree — and then reads the verifier's answer back rather
than writing one. Both the Sourcify record and each explorer's own panel are recorded:

| Lane | Sourcify | Explorer panel | Arbiscan |
| --- | --- | --- | --- |
| Arbitrum Sepolia (421614) | `exact_match`, 3/3 | [Blockscout](https://arbitrum-sepolia.blockscout.com) · verified, fully verified | not published — `pending_key`, see below |
| Robinhood Chain Testnet (46630) | `exact_match`, 3/3 | [Robinhood explorer](https://explorer.testnet.chain.robinhood.com) · `Pass - Verified` | n/a |

The Sourcify repository entries are linked per contract from the site's Evidence screen, next to the
drift report they corroborate. `exact_match` means Sourcify recompiled the source, compared the
creation bytecode *and* the runtime bytecode, and matched the compiler metadata as well — the same
comparison an explorer performs.

Arbiscan itself is the one panel still missing, and it is missing for a mundane reason: it requires
an `ARBISCAN_API_KEY`. Sourcify's own attempt to forward the submission there was refused with
"Daily limit of 500 source code submissions reached", which is Sourcify's shared key rather than
ours. Nothing about the contracts is unpublished; one explorer's UI is.

### The Arbiscan panel finishes itself once a key exists

```bash
npm run verify:arbiscan            # submit, wait, read back, record
npm run verify:arbiscan -- --dry-run     # build the exact request and send nothing
npm run verify:arbiscan -- --status-only # read the panels back, never submit
```

This is wired into `npm run preflight` and into `npm run redeploy:sepolia`, so it runs on the normal
path rather than being remembered. It submits the same standard JSON input Sourcify accepted — read
from the build-info, not the working tree — with the constructor arguments the deploy script used,
then polls the queue and **reads the result back from Arbiscan** before recording anything. Its output
is `packages/contracts/evidence/arbiscan.json`, which the site renders next to the Sourcify record.

Three properties are deliberate:

- **No key, no silence.** It records `pending_key` per contract, prints the one command that would
  finish it, and exits 0, so a preflight run does not fail for someone who has not signed up for a
  key.
- **A missing key cannot erase a fact.** An earlier confirmed publication is preserved when the key
  is absent on a later run; only the read-back date moves.
- **It never assumes success.** A submission is recorded as published only if `getsourcecode` then
  reports the source present; otherwise it writes `not published`, the queue message, and exits 1.

`npm run verify:arbiscan -- --dry-run` is the way to check the request without a key: it prints the
qualified contract name, the compiler version (`v0.8.25+commit.b61c2a91`), the number of sources, and
the ABI-encoded constructor arguments for each of the three contracts.

## Settlement token — Paxos USDG, on both lanes

| Network | Address | Symbol | Decimals |
| --- | --- | --- | --- |
| Arbitrum Sepolia | [`0xFFC95faa3d63Cde504a05B567C600B78C0b41892`](https://sepolia.arbiscan.io/address/0xFFC95faa3d63Cde504a05B567C600B78C0b41892) | USDG | 6 |
| Robinhood Chain Testnet | [`0x7E955252E15c84f5768B83c41a71F9eba181802F`](https://explorer.testnet.chain.robinhood.com/address/0x7E955252E15c84f5768B83c41a71F9eba181802F) | USDG | 6 |

These are the issuer's published testnet deployments
([Paxos docs](https://docs.paxos.com/guides/stablecoin/usdg/testnet)), not our own token. The token
lane is pointed at them, so the caps quoted in the product are in real USDG base units.

The addresses and decimals above are **read from the contracts, not copied from the docs**:

```bash
npm run check:settlement
```

It calls `symbol()` and `decimals()` at each declared address, compares them with
`packages/contracts/evidence/live-deployments.json`, and fails when they disagree. That check exists
because decimals are the part of a token integration a reader cannot eyeball: a lane configured at
the wrong scale misreads every cap by a power of ten, and nothing in the policy source would look
wrong. `enroll-safe.ts` reads `decimals()` again before writing any cap, and refuses to continue if it
disagrees with the manifest.

The evidence pack (`npm run evidence -w packages/contracts`) still uses a USDG-shaped local token,
because an in-process chain has no issuer contract to transfer. It exercises the lane's *logic*; this
check and the live lanes cover the *address*.

## Arbitrum Sepolia (primary) — current, deployed 2026-10-02

| Field | Value |
| --- | --- |
| Network | Arbitrum Sepolia |
| Chain ID | 421614 |
| PolicyManager | [`0x3e394b1d9781a71D71905d028C530B29Aa0021a6`](https://sepolia.arbiscan.io/address/0x3e394b1d9781a71D71905d028C530B29Aa0021a6) · [deploy](https://sepolia.arbiscan.io/tx/0xcf05d7550a84f8f9025d72f1a1ff6a48b56e2f6244e7b28c359b66ec5c8dd02d) |
| ExecutionGuard | [`0x5e60F2D4E3F50eA16Ed0413e718535d720c3D5cC`](https://sepolia.arbiscan.io/address/0x5e60F2D4E3F50eA16Ed0413e718535d720c3D5cC) · [deploy](https://sepolia.arbiscan.io/tx/0x23f446d300ea4c6cfaf39191d95091ff7be5a06e32c6482354eac3a03b59dd86) |
| SafeTreasuryGuard | [`0x01b03b1e0E20F84a9Fa832AbeB58283e30cA2F1b`](https://sepolia.arbiscan.io/address/0x01b03b1e0E20F84a9Fa832AbeB58283e30cA2F1b) · [deploy](https://sepolia.arbiscan.io/tx/0x8cf1615ca6849bfef4fc3b33ba554a28d8cddb8459b25c3191970d579563eff6) |
| Treasury (Gnosis Safe v1.4.1) | [`0x5769B6973cF7E85acfa7590763549bfCf80Cbb82`](https://sepolia.arbiscan.io/address/0x5769B6973cF7E85acfa7590763549bfCf80Cbb82) · [creation](https://sepolia.arbiscan.io/tx/0x53267ccaa5b33b4bceb07d251439f479cd3612714c2f524ee191bb09b61913b9) |
| Guard installed via the Safe's own `execTransaction` | [tx](https://sepolia.arbiscan.io/tx/0x98dc84c456e81c554ba22a137ac85b6b79da160288fdb796cb9ab8c1d295c907) |
| Allowed spend (settled, status 1) | [tx](https://sepolia.arbiscan.io/tx/0x1313db311ce1e99b3623c4b42e6d6f1e531f40bc3e7032f88c68a790343ba216) |
| Refused spend (reverted by the guard, status 0) | [tx](https://sepolia.arbiscan.io/tx/0xff26308871c5b7c36b477940dc1b7307f8fdbbd979190ef89760b86902a99524) |
| Source published | Sourcify `exact_match` (creation + runtime) and a verified source panel on Arbitrum Sepolia Blockscout; Arbiscan's own panel pending `ARBISCAN_API_KEY` |
| Freeze drill · pause | [tx](https://sepolia.arbiscan.io/tx/0xae409c709726042ad9ba526f276951528b89c095e42673ea2efb29599496e3e0) |
| Freeze drill · refused while frozen (status 0) | [tx](https://sepolia.arbiscan.io/tx/0x11bc033b452358254993cbacee3f146ef9e8823998d37d6177f080f7837e7925) |
| Freeze drill · unpause | [tx](https://sepolia.arbiscan.io/tx/0x7d12365ec32fc81d0128b51174432151d11015a04dbc87f8d305cc34d0499ff8) |
| Freeze drill · spend settles again (status 1) | [tx](https://sepolia.arbiscan.io/tx/0xdc4b455856bf141b4282c2e20518ba00f95396b7c52b015d0ce16ad06c91a8b9) |
| Live product | https://arb-guardian.sithunyein.com (Vercel alias: https://arb-guardian.vercel.app) |

## Robinhood Chain Testnet — current, deployed 2026-10-02

| Field | Value |
| --- | --- |
| Network | Robinhood Chain Testnet |
| Chain ID | 46630 |
| RPC | `https://rpc.testnet.chain.robinhood.com` |
| Explorer | https://explorer.testnet.chain.robinhood.com |
| PolicyManager | [`0x3E4a51B35a984f33D4F71CEf96Eb8f08fcC8Ef2b`](https://explorer.testnet.chain.robinhood.com/address/0x3E4a51B35a984f33D4F71CEf96Eb8f08fcC8Ef2b) · [deploy](https://explorer.testnet.chain.robinhood.com/tx/0x732c69171fe297bec508384384aac2d7b3574c1394f40be42bacd8f6bd835a54) |
| ExecutionGuard | [`0xD1bbF5e71295696B2011408eAa13dEb69adcD21D`](https://explorer.testnet.chain.robinhood.com/address/0xD1bbF5e71295696B2011408eAa13dEb69adcD21D) · [deploy](https://explorer.testnet.chain.robinhood.com/tx/0xaba91ef8432d20c0a81e98985afd3678c87629cb9b5c7ce7ef93e0b1190fa802) |
| SafeTreasuryGuard | [`0xe10afE3da5546fc0F34c6F38DB3920BD5f5C6999`](https://explorer.testnet.chain.robinhood.com/address/0xe10afE3da5546fc0F34c6F38DB3920BD5f5C6999) · [deploy](https://explorer.testnet.chain.robinhood.com/tx/0x20a8b36afa59c6c7dcc7b3a35630c838e025dc4884cd7ef2cfe0ab258a7d488a) |
| Treasury (Gnosis Safe v1.4.1) | [`0x8D9540796444ded4dA17fC0FA38CcBb9a701991a`](https://explorer.testnet.chain.robinhood.com/address/0x8D9540796444ded4dA17fC0FA38CcBb9a701991a) · [creation](https://explorer.testnet.chain.robinhood.com/tx/0xb10a404f19aa129155ec4518f3db29980fb6318bf487cf827c0dc2ee75896f8f) |
| Guard installed via the Safe's own `execTransaction` | [tx](https://explorer.testnet.chain.robinhood.com/tx/0x64240c9782c7bead68997536063c0cc029bc1df9e46d5551c69af2449f2c73a3) |
| Allowed spend (settled, status 1) | [tx](https://explorer.testnet.chain.robinhood.com/tx/0xb7f97778c85b99e3188bdb75258fd351ff873a055896ea4781e1363a7ae643c8) |
| Refused spend (reverted by the guard, status 0) | [tx](https://explorer.testnet.chain.robinhood.com/tx/0x44e08cf915f90b7394eb0be18cd10ac44399e2e685f47821ebbd639d1412f515) |
| Source published | **`Pass - Verified`** for all three contracts on the Robinhood explorer, and Sourcify `exact_match` (creation + runtime) |

> The refused transaction exists onchain on purpose. Gas estimation would reject the send before it
> reached the network — which is where a refusal most often stays invisible — so the enrollment
> supplies a gas limit instead. The transaction is mined, the guard reverts inside the Safe, and it
> keeps a hash like any other: status `0`, 90,135 gas on Sepolia, 93,410 on Robinhood, no logs.

## Superseded: the 2026-07-30 deployment (history)

| Lane | PolicyManager | ExecutionGuard | SafeTreasuryGuard | Treasury |
| --- | --- | --- | --- | --- |
| Arbitrum Sepolia | [`0x4f3dC29…Cf76`](https://sepolia.arbiscan.io/address/0x4f3dC29Ed0c8844E31fD84c3eE22C1C94158Cf76) | [`0x10fbe21…6124`](https://sepolia.arbiscan.io/address/0x10fbe21ccb611A2aBF12a784C67278eAf6dE6124) | [`0xcba30F6…b211`](https://sepolia.arbiscan.io/address/0xcba30F60BE3FB0fB0e9db0C816c4ab9Fa2f7b211) | [`0x009D53F…fa542`](https://sepolia.arbiscan.io/address/0x009D53F97a07d9E141eA5ff90354d7bE748fa542) |
| Robinhood Chain Testnet | [`0x57077DA…6758F`](https://explorer.testnet.chain.robinhood.com/address/0x57077DA6DEFCAAB83aEAbE080641D5D1Ed66758F) | [`0x4019C44…7613`](https://explorer.testnet.chain.robinhood.com/address/0x4019C445bbc593eA5eb13D319Ca427aA8aDc7613) | [`0xa168227…E729`](https://explorer.testnet.chain.robinhood.com/address/0xa168227dB7a3340e988Dbf9Cd01894840617E729) | [`0x10fbe21…6124`](https://explorer.testnet.chain.robinhood.com/address/0x10fbe21ccb611A2aBF12a784C67278eAf6dE6124) |

The Robinhood enrolled-treasury address of that deployment was character-for-character identical to
the Arbitrum Sepolia ExecutionGuard address. That is legitimate — separate chains, independent
address spaces, different code — and is noted so it is not mistaken for a copy-paste error.

## Token lane (USDG)

USDG is natively issued on Robinhood Chain and is the lending asset in Robinhood Earn. To open a
bounded USDG lane at deploy time:

```bash
USDG_ADDRESS=<usdg token address> \
USDG_TREASURY_ADDRESS=<treasury wallet or Safe> \
USDG_DAILY_LIMIT_UNITS=5000000000 \
USDG_RECIPIENT=<allowlisted counterparty> \
npm run deploy:robinhood -w packages/contracts
```

`USDG_DAILY_LIMIT_UNITS` is in the token's **base units**. USDG uses 6 decimals, so `5000000000`
is a 5,000 USDG daily cap. Setting it in wei-sized numbers (e.g. `5000e18`) would be wrong by six
orders of magnitude — `packages/contracts/test/TokenPolicy.test.ts` pins that mistake.

If you register USDG but set no cap, the lane is **deny-by-default** for every wallet: the token
is known to the guard, but nobody may move it until a limit is configured.

## Integration notes

- `ExecutionGuard` — operator/API pre-execution validation and spend recording. It holds no funds
  and cannot stop a transfer; hard enforcement is the Safe path.
- `SafeTreasuryGuard` — Gnosis Safe v1.4.1 `ITransactionGuard`. Verified against real Safe
  contracts in `packages/contracts/test/RealSafeGuard.test.ts`.
- Dual-chain deploy supports Arbitrum qualification **and** the Robinhood reserved lane.
