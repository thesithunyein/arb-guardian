# Demo Runbook (Judge Session)

## 1) Generate the recording sheet

```bash
npm run demo:sheet
```

This is the script: addresses, explorer links, the settlement-token reading, the guard-proof counts,
the beats, and the list of things not to claim. It is built from the committed evidence reports rather
than typed by hand, so it cannot quote an address that has since been redeployed. If a check has not
been run it says so at the top — run it, or admit it on camera.

## 2) Make the evidence current

```bash
npm run check:deployed     # live bytecode vs this source
npm run check:settlement   # USDG address + decimals on both lanes
npm run evidence -w packages/contracts   # 15/15 cases against a real Gnosis Safe
```

## 3) Start services

- API: `npm run dev -w apps/api`
- Web: `npm run dev -w apps/web`
- Or present the deployed product: https://arb-guardian.vercel.app

## 4) Seed demo state (local only)

- `npm run demo:seed`
- `npm run demo:smoke` — checks the endpoints respond before you go on

## 5) Present with timing

- Beats: `docs/demo-timing-track.md`
- Evidence per beat: the table in the recording sheet from step 1

## 6) The two things worth saying out loud

- **The deployed addresses are the current build**, 6/6 byte-matched to this source and source-published
  on Sourcify; the 2026-07-30 addresses are superseded and kept only as history in
  `docs/live-deployment.md`. Say which set you are showing before a judge asks.
- **Arbiscan's source panel is the one open verification item** because it needs an API key. The
  keyless record exists — say "published on Sourcify with a verified Blockscout panel", not "verified
  on Arbiscan".
- **`SECURITY.md` is honest about what is not solved**: a UTC-day window rather than rolling 24 hours,
  approvals bounded by the allowlist rather than by a number, one admin key, and no third-party audit.

## 7) Backup if the UI fails

- `GET /health`
- `POST /risk/assess`
- `GET /incidents`
- `POST /incidents/:incidentId/action`
- `GET /incidents/audit`

## 8) Freeze drill, if asked whether the freeze path is real

```bash
npm run drill:incident:sepolia
```

Runs against the live lane, pauses it, proves the normally-settling spend is refused while frozen,
then unpauses from a `finally` block. Hashes and timings: `docs/incident-drill.md`. It spends testnet
gas, so do not run it for the first time on stage.

## 9) If the demo is on the redeployed contracts

```bash
npm run deploy:sepolia   -w packages/contracts
npm run verify           -w packages/contracts -- --network arbitrumSepolia
npm run deploy:robinhood -w packages/contracts
npm run verify           -w packages/contracts -- --network robinhoodTestnet
```

Then flip each network's `status` to `"current"` in
`packages/contracts/evidence/live-deployments.json` and update the addresses in the same commit.
`npm run check:deployed` fails until that is done, which is the reminder that it is not.
