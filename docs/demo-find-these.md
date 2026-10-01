# Where to click (labels that exist in the current build)

Two surfaces, and they prove different things. Say which one you are on when you switch.

| Surface | What it proves |
| --- | --- |
| **https://arb-guardian.vercel.app** | The operator workflow: check a spend, see the decision, freeze |
| **`npm run evidence -w packages/contracts`** (repo) | The enforcement: a real Safe refuses the spend, with the revert reason and the policy version |

Hard refresh once: `Ctrl+Shift+R`.

---

## 1) The refusal is the product — Review tab

1. Click **Open** on the landing screen.
2. Click the tab **Review**.
3. Pick the spend **“Agent asks for standing approval”**, then **Check a spend**.
4. You get **Block — unlimited approval**. That intent is an approval-class call, which is the
   drain primitive this exists to stop.
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

1. PolicyManager — https://sepolia.arbiscan.io/address/0x4f3dC29Ed0c8844E31fD84c3eE22C1C94158Cf76
2. ExecutionGuard — https://sepolia.arbiscan.io/address/0x10fbe21ccb611A2aBF12a784C67278eAf6dE6124
3. SafeTreasuryGuard — https://sepolia.arbiscan.io/address/0xcba30F60BE3FB0fB0e9db0C816c4ab9Fa2f7b211
4. Treasury Safe — https://sepolia.arbiscan.io/address/0x009D53F97a07d9E141eA5ff90354d7bE748fa542
5. Allowed Safe execution — https://sepolia.arbiscan.io/tx/0xd4ec25f77a9ea06d053997ea2d7e68e87a91518f8fa4d7b60618d2ca80a6978a

Those are **verified source, earlier semantics** — the daily limit there failed open and the token
lane does not exist in that bytecode. `docs/live-deployment.md` lists exactly what changed. If you
show them, say that, or show the Vault tab proof instead.

---

## Super simple record path

1. **Landing** → the one-line claim: money without the ability to drain the account
2. **Review** → “Agent asks for standing approval” → **Block**
3. **Review** → “Normal vendor payout” → **Allow**
4. **Alerts** → **Freeze the treasury** → **Unfreeze**
5. **Vault** → guard proof table + attestation replay (say: *rendered, not asserted*)
6. **Playbooks** → conformance fixtures (say “regression suite”, never “AI accuracy”)
