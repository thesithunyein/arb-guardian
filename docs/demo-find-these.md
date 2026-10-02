# Where to click (labels that exist in the current build)

Two surfaces, and they prove different things. Say which one you are on when you switch.

| Surface | What it proves |
| --- | --- |
| **https://arb-guardian.sithunyein.com** | The operator workflow: check a spend, see the decision, freeze |
| **`npm run evidence -w packages/contracts`** (repo) | The enforcement: a real Safe refuses the spend, with the revert reason and the policy version |

Hard refresh once: `Ctrl+Shift+R`.

---

## 1) The refusal is the product — Review tab

1. Click **Open** on the landing screen.
2. Click the tab **Review**.
3. Pick the spend **“Agent asks for standing approval”**, then **Check a spend**.
4. You get **Block — standing approval**. Even a finite allowance can be exercised later through
   `transferFrom` without a new Safe transaction, so the contract requires direct transfers.
5. Switch to **“Normal vendor payout”** and run it: **Allow — within policy**.

Point out the two numbers in the receipt: **Day limit** and **Spent today**. They are the whole
idea — a delegate can spend, but it cannot spend past the ceiling.

---

## 2) The freeze — Alerts tab

1. Click the tab **Alerts**.
2. The blocked spend is queued there. Click **Freeze the treasury**.
3. Status changes to **Treasury frozen**. That maps to `PolicyManager.pause()`, and it stops
   spending even for spends that would otherwise be allowed.
4. **Unfreeze** reverses it. The audit log below records who did what.

## 3) The proof — Vault tab

Click the tab **Vault**. Everything there is generated, not written:

- **What is live, and what the proof covers** — states plainly that the deployed testnet
  addresses are the earlier native-lane build (see `docs/live-deployment.md`).
- **Guard proof · every case, with its revert reason** — the 15 cases from
  `packages/contracts/evidence/guard-proof.json`, including row 1: the same payment as row 2,
  executed *before* the guard was installed, which settles.
- **Policy attestation · replayable from logs** — the amendment count, the digest-chain replay
  result, and how many decisions are stamped with a policy version that exists in the log.

Say this, verbatim if you like: *“The site doesn't assert the proof, it renders the artifact.
Regenerate it with one command and the numbers change if the contracts do.”*

---

## 4) Policy conformance — Playbooks tab

1. Click the tab **Playbooks**.
2. Look for **What the helper can do**. You should see
   `14/14 fixed policy cases match spec (100%). Regression fixtures only — not model validation.`

**Do not call this “accuracy” on camera.** It is a regression suite: expected outcomes were
written alongside the rules, so 100% is expected. Say “conformance fixtures” or “the rule engine
matches its spec”. Claiming AI accuracy is the fastest way to lose credibility with a judge,
because **there is no model in this repo**.

---

## 5) If you record the contract side instead

Open these five Arbiscan links in tabs before you start, then talk over them:

1. PolicyManager — https://sepolia.arbiscan.io/address/0x3e394b1d9781a71D71905d028C530B29Aa0021a6
2. ExecutionGuard — https://sepolia.arbiscan.io/address/0x5e60F2D4E3F50eA16Ed0413e718535d720c3D5cC
3. SafeTreasuryGuard — https://sepolia.arbiscan.io/address/0x01b03b1e0E20F84a9Fa832AbeB58283e30cA2F1b
4. Treasury Safe — https://sepolia.arbiscan.io/address/0x5769B6973cF7E85acfa7590763549bfCf80Cbb82
5. Allowed Safe execution — https://sepolia.arbiscan.io/tx/0x1313db311ce1e99b3623c4b42e6d6f1e531f40bc3e7032f88c68a790343ba216
6. Refused Safe execution (status 0, reverted by the guard) — https://sepolia.arbiscan.io/tx/0xff26308871c5b7c36b477940dc1b7307f8fdbbd979190ef89760b86902a99524

These are the **current** addresses, deployed 2026-10-02 and byte-matched to this repository by
`npm run check:deployed`. All six contracts are source-published: Sourcify answers `exact_match` for
creation and runtime bytecode on both lanes, and each contract reads as verified on its own explorer
panel — the Robinhood lane at
https://explorer.testnet.chain.robinhood.com/address/0x3E4a51B35a984f33D4F71CEf96Eb8f08fcC8Ef2b
(`Pass - Verified`) and Arbitrum Sepolia on Blockscout. Arbiscan's own panel is the one item still
missing, because it requires an API key — so say "published on Sourcify with a verified Blockscout
panel" rather than "verified on Arbiscan" until that key exists.

---

## Super simple record path

1. **Landing** → the one-line claim: money without the ability to drain the account
2. **Review** → “Agent asks for standing approval” → **Block**
3. **Review** → “Normal vendor payout” → **Allow**
4. **Alerts** → **Freeze the treasury** → **Unfreeze**
5. **Vault** → guard proof table + attestation replay (say: *rendered, not asserted*)
6. **Playbooks** → conformance fixtures (say “regression suite”, never “AI accuracy”)
