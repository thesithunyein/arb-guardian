# Walkthrough recording — live product, 2026-10-02

`walkthrough-2026-10-02.webm` (1.35 MB) is an unedited screen capture of the deployed product at
<https://arb-guardian.sithunyein.com> on 2026-10-02, driven only through its own interface. It exists
because the submission previously had no demo artifact at all.

**What it is:** a silent capture of a real session against the live site — no narration, no editing,
no local build.

**What it is not:** the narrated, 3-minute judge video. `docs/demo-timing-track.md` is the script for
that, and it is still worth recording with a voice track; this capture is the raw material and the
honest fallback.

## What the capture shows, in order

1. **Landing page** — the operator framing ("Know before money moves"), the three-step control loop,
   the FAQ, and the docs entry points.
2. **Alert list** — two incidents from the freeze drill, already resolved and marked `frozen` /
   "Resolved · freeze confirmed", plus one open alert. These are the same runs recorded in
   `docs/incident-drill.md`; the console shows them without any state being staged for the camera.
3. **Review** — a pending request: a standing approval of 1 ETH to an unlisted address against a
   0.5 ETH daily limit, with `Trusted list: No`. The decision reads **"Block: standing approval"**,
   the policy engine suggests freezing the treasury, and the page states that the engine cannot move
   money and that freezing needs an operator click.
4. **Why this decision** — the rule breakdown behind that refusal: destination not allowlisted
   (critical), daily wallet limit exceeded (high), approval transactions require explicit review
   (medium).
5. **Evidence** — the drift report (6 contracts read from chain, 0 drifted, matched), the settlement
   token read from the issuer's own contracts on both lanes (`USDG · 6 decimals`), the guard proof
   with every case and its revert reason — including `PolicyManagerPaused()` for the freeze, and the
   before/after pair where the same payment settles without the guard and is refused with it — the
   replayed policy attestation digests, and the explorer links for both lanes.

## Limits, stated plainly

- **No narration and no voice-over.** A viewer has to read the screen.
- **The token lane shows no live USDG transfer**, because none exists: the issuer's testnet faucet is
  geo-restricted from the machine that recorded this (HTTP 403), so testnet USDG could not be
  obtained. The lane is configured, capped, and deny-by-default; its address and decimals are read
  from the issuer's contracts on chain by `npm run check:settlement`.
- **The Arbiscan source panel is still unpublished**, because it needs `ARBISCAN_API_KEY`. The six
  contracts are published keylessly on Sourcify with exact creation and runtime matches, and their
  explorer panels on Arbitrum Sepolia (Blockscout) and Robinhood Chain read as verified — see
  `docs/live-deployment.md`.
- **Recorded against production, so it cannot be replayed identically.** Balances, counters and
  incident lists move; the beats can be reproduced, the pixels cannot.
