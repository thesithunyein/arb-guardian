# Incident drill — freeze, refuse, resume (2026-10-02)

The freeze path was the last thing in the product that existed only as a claim. This is the record of
running it end to end against the live deployment, through the public API, on the addresses
`docs/live-deployment.md` points at.

Reproduce it with one command (it spends testnet gas and pauses the primary lane for a few seconds):

```bash
npm run drill:incident:sepolia
```

Machine-readable output: `packages/contracts/evidence/incident-drill.json`.

## What the drill does, and why in that order

Each step exists to make the next one mean something:

1. **A risky request is refused.** A standing approval from the treasury to a non-allowlisted address
   is posted to `POST /api/risk/assess`. It scores 80 and is blocked.
2. **The operator mitigates.** `POST /api/incidents/:id/action` runs the recommended playbook, which
   calls `pause()` on `PolicyManager` — a real transaction, not a UI state change.
3. **The same spend that is allowed when live is refused while frozen.** The Safe attempts the
   payment the enrollment already proved it may make. The guard reverts it inside `execTransaction`
   with `PolicyManagerPaused()`. A refusal is only interesting next to the case that settles without
   it, which is why this is the same recipient and amount as the allowed spend, not a new one.
4. **The operator unfreezes and the lane resumes.** The same spend settles again, so the freeze is
   a reversible control rather than a way to brick the treasury.

Step 4 also runs from a `finally` block: if any earlier step throws, the script clears the pause
before it exits. A drill that leaves the live lane frozen is worse than no drill.

## Result

| Step | Evidence |
| --- | --- |
| Refused decision | score **80**, rule `RULE_ALLOWLIST_DESTINATION` + `RULE_APPROVAL_SURFACE`, playbook `freeze-wallet-and-revoke-approvals`, incident `inc-0x2b956dc6…` (`critical`) |
| Detection latency | **1.6 s** from submission to a blocked decision with an incident |
| Freeze | pause tx [`0xae409c70…96e3e0`](https://sepolia.arbiscan.io/tx/0xae409c709726042ad9ba526f276951528b89c095e42673ea2efb29599496e3e0), **5.8 s** from decision to a mined pause |
| Refused while frozen | [`0x11bc033b…7e7925`](https://sepolia.arbiscan.io/tx/0x11bc033b452358254993cbacee3f146ef9e8823998d37d6177f080f7837e7925) — status **0**, 69,247 gas |
| Unfreeze | unpause tx [`0x7d12365e…499ff8`](https://sepolia.arbiscan.io/tx/0x7d12365ec32fc81d0128b51174432151d11015a04dbc87f8d305cc34d0499ff8), **5.2 s** |
| Resumed | [`0xdc4b4558…c91a8b9`](https://sepolia.arbiscan.io/tx/0xdc4b455856bf141b4282c2e20518ba00f95396b7c52b015d0ce16ad06c91a8b9) — status **1**, the spend settles again |
| Total | **33.8 s** for the whole drill |

Policy `paused()` was read back from the chain after each transition, and read again after the script
exited: `false`. The lane is live.

## Visible in the product, not just in this file

Both drill runs appear in the deployed console's own alert list as `frozen` / "Resolved · freeze
confirmed" (`0x5769B6…` is the enrolled Safe), and the live counters moved with real traffic:

```json
{ "totalAssessments": 2, "blockedCount": 2, "blockedRate": 1, "avgScore": 80,
  "incidentCount": 2, "criticalIncidentCount": 2, "persistence": { "durable": true, "backend": "vercel-kv" } }
```

That is self-operated drill traffic, not external users — the counters prove the path works and that
the store is durable, nothing more. Product-market fit still needs real pilots.

## What the first run exposed

The first invocation ended at exactly the step it was meant to prove: ethers throws on a status-0
receipt instead of returning it, so the refusal — the expected outcome — crashed the script. The
`finally` block cleared the pause, the lane never stayed frozen, and the fix is in
`waitAllowingRevert()`. A refusal that the code treats as an error is how a blocked transaction
usually ends up invisible, which is the same failure the refused-vs-allowed pair exists to prevent.

## What this does not show

- **No external operator.** The drill is run by the project's own key through the public API.
- **No USDG movement.** The token lane is configured and deny-by-default on both lanes, but the
  issuer's testnet faucet (`faucet.paxos.com`) is geo-restricted from this machine — HTTP 403, "not
  available in your location" — so a live bounded USDG payment could not be recorded. The token
  lane's logic is proven by `npm run evidence -w packages/contracts` against a USDG-shaped token,
  and its live address and decimals by `npm run check:settlement`.
- **No independent review.** Everything here is produced by the team that wrote the code.
