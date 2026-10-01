# Live deployment

Public on-chain qualification proof for Arb Guardian.

## Verification snapshot (2026-10-02)

- Production app: [arb-guardian.sithunyein.com](https://arb-guardian.sithunyein.com) returned HTTP
  200 and resolves to Vercel-managed DNS.
- Vercel alias: [arb-guardian.vercel.app](https://arb-guardian.vercel.app) returned HTTP 200.
- Same-origin API health returned `{"status":"ok",...}`; `/api/status` reached Arbitrum Sepolia
  for the recorded deployment.
- The API deliberately labels the recorded deployment **superseded**, not current. The corrected
  build cannot be claimed live until a funded deployer, Arbitrum Sepolia ETH, and an Arbiscan API
  key are supplied.

> ## ⚠️ These deployments implement the earlier semantics — redeploy before submitting
>
> The addresses below were deployed **2026-07-30**. They predate two correctness changes now in
> the repository:
>
> 1. **The daily limit used to fail open.** `if (dailyLimit > 0 && ...)` meant a limit of `0`
>    was *unlimited*, so an unconfigured wallet had no protection and clearing a limit opened the
>    lane. It now fails closed: `0` blocks all spending, and uncapped spending requires an
>    explicit `UNLIMITED_LIMIT`.
> 2. **The approval rule could not block.** It scored `+20` against a `60` threshold, so
>    `approve` to an allowlisted destination always passed. Approval-class calls now block by
>    default, matched by name *and* selector, and standing approvals are refused outright.
>
> The token lane (USDG) does not exist in the deployed bytecode at all, and neither does the
> versioned policy attestation (`policyVersion` / `policyDigest`, `PolicyAmendment` history).
>
> **Do not present the addresses below as the current build.** Redeploy, verify, and replace this
> file with the new addresses and transaction hashes:
>
> ```bash
> npm run deploy:sepolia  -w packages/contracts
> npm run verify          -w packages/contracts -- --network arbitrumSepolia
> npm run deploy:robinhood -w packages/contracts
> npm run verify          -w packages/contracts -- --network robinhoodTestnet
> ```
>
> The deploy script writes `packages/contracts/deployments/<network>.json`, which `npm run verify`
> reads for addresses and constructor arguments.
>
> Then update `packages/contracts/evidence/live-deployments.json`: replace every address and set each
> network's `status` to `"current"`. `npm run check:deployed` reads the bytecode at those addresses
> over public RPC and compares the Solidity metadata fingerprint with this repository's build. It
> **fails today** because the addresses above really are an older build — that is the point. Leave
> `status` as `"superseded"` after a redeploy and it keeps failing, which is the reminder to finish
> the job.
>
> The Vault tab in the web app says the same thing on screen, so a judge clicking around cannot
> mistake these addresses for the current source. That statement is generated from this file's
> status, not from a claim in the marketing copy.

## Arbitrum Sepolia (primary) — superseded

| Field | Value |
| --- | --- |
| Network | Arbitrum Sepolia |
| Chain ID | 421614 |
| PolicyManager | [`0x4f3dC29Ed0c8844E31fD84c3eE22C1C94158Cf76`](https://sepolia.arbiscan.io/address/0x4f3dC29Ed0c8844E31fD84c3eE22C1C94158Cf76) |
| ExecutionGuard | [`0x10fbe21ccb611A2aBF12a784C67278eAf6dE6124`](https://sepolia.arbiscan.io/address/0x10fbe21ccb611A2aBF12a784C67278eAf6dE6124) |
| SafeTreasuryGuard | [`0xcba30F60BE3FB0fB0e9db0C816c4ab9Fa2f7b211`](https://sepolia.arbiscan.io/address/0xcba30F60BE3FB0fB0e9db0C816c4ab9Fa2f7b211) |
| Treasury (enrolled) | [`0x009D53F97a07d9E141eA5ff90354d7bE748fa542`](https://sepolia.arbiscan.io/address/0x009D53F97a07d9E141eA5ff90354d7bE748fa542) |
| Live product | https://arb-guardian.sithunyein.com (Vercel alias: https://arb-guardian.vercel.app) |

## Robinhood Chain Testnet — superseded

| Field | Value |
| --- | --- |
| Network | Robinhood Chain Testnet |
| Chain ID | 46630 |
| RPC | `https://rpc.testnet.chain.robinhood.com` |
| Explorer | https://explorer.testnet.chain.robinhood.com |
| PolicyManager | [`0x57077DA6DEFCAAB83aEAbE080641D5D1Ed66758F`](https://explorer.testnet.chain.robinhood.com/address/0x57077DA6DEFCAAB83aEAbE080641D5D1Ed66758F) |
| ExecutionGuard | [`0x4019C445bbc593eA5eb13D319Ca427aA8aDc7613`](https://explorer.testnet.chain.robinhood.com/address/0x4019C445bbc593eA5eb13D319Ca427aA8aDc7613) |
| SafeTreasuryGuard | [`0xa168227dB7a3340e988Dbf9Cd01894840617E729`](https://explorer.testnet.chain.robinhood.com/address/0xa168227dB7a3340e988Dbf9Cd01894840617E729) |
| Treasury (enrolled) | [`0x10fbe21ccb611A2aBF12a784C67278eAf6dE6124`](https://explorer.testnet.chain.robinhood.com/address/0x10fbe21ccb611A2aBF12a784C67278eAf6dE6124) |
| Deployed | 2026-07-30T14:52:40.069Z |

> **Address collision note.** The Robinhood enrolled-treasury address is character-for-character
> identical to the Arbitrum Sepolia ExecutionGuard address. This is legitimate — separate chains
> have independent address spaces and the code at each is different — but it is called out
> explicitly so it is not mistaken for a copy-paste error during submission review.

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
