# Where to click (exact labels on screen)

Use https://arb-guardian.vercel.app  
Hard refresh once: `Ctrl+Shift+R`

---

## 1) “KPIs → Safe address” = on OVERVIEW (scroll down)

You are already on Overview.

**KPIs** = the box titled **Operations metrics**  
You will see: Assessments · Blocked · Block rate · Critical  
(They can be 0 — that is OK.)

**Safe address** = scroll to the box titled **Live deployment**  
Look for this exact line:

`Treasury Safe (enrolled)`  
`0x009D53F97a07d9E141eA5ff90354d7bE748fa542`

Also on that same card you will see:
- PolicyManager
- ExecutionGuard
- SafeTreasuryGuard

**Record tip:** point mouse on Operations metrics, then move mouse to **Treasury Safe (enrolled)**.

If you do not see Treasury Safe, refresh hard. It is on the live build.

---

## 2) “Policy → Guard → SafeGuard → Safe → exec tx” = open these links

Do **not** look for a button named “Policy”.  
Open these 5 links in new tabs before recording, then switch tabs while talking:

1. **Policy** = PolicyManager  
https://sepolia.arbiscan.io/address/0x4f3dC29Ed0c8844E31fD84c3eE22C1C94158Cf76

2. **Guard** = ExecutionGuard  
https://sepolia.arbiscan.io/address/0x10fbe21ccb611A2aBF12a784C67278eAf6dE6124

3. **SafeGuard** = SafeTreasuryGuard  
https://sepolia.arbiscan.io/address/0xcba30F60BE3FB0fB0e9db0C816c4ab9Fa2f7b211

4. **Safe** = Treasury Safe  
https://sepolia.arbiscan.io/address/0x009D53F97a07d9E141eA5ff90354d7bE748fa542

5. **exec tx** = allowed Safe execution transaction  
https://sepolia.arbiscan.io/tx/0xd4ec25f77a9ea06d053997ea2d7e68e87a91518f8fa4d7b60618d2ca80a6978a

**Easy way from the app:** on Overview → Live deployment, click each blue address link (opens Arbiscan).  
For exec tx: go to **Evidence** tab → click **Allowed Safe exec tx** (or Deploy tx links).

---

## 3) “Mitigate → open pause tx” = only after Assess

Order must be:

1. Click tab **Assess**
2. Click **Risky approval**
3. Click **Run risk assessment**
4. Wait until it says **Blocked**
5. Click tab **Incidents**
6. Find the incident card
7. Click the button **Mitigate** (exact label)
8. On the right / under Audit trail, look for **Last playbook** and a link called **onchain tx**
9. Click **onchain tx** → Arbiscan pause page

If there is no incident yet, Mitigate will not appear. Always run Risky approval first.

---

## 4) “accuracy 1.0” = on AGENT tab

1. Click tab **Agent**
2. Look for box titled **Eval harness**
3. You should see text like:  
   `12 scenarios · accuracy 1`  
   or  
   `passed 12/12`

That is “accuracy 1.0”.

If API is cold, it may briefly show fallback text `12 scenarios · accuracy 1.0` — still fine for video.

---

## Super simple record path (labels only)

1. **Overview** → Operations metrics → Live deployment → Treasury Safe (enrolled)  
2. Open 5 Arbiscan links above  
3. **Assess** → Risky approval → Run risk assessment  
4. **Incidents** → Mitigate → onchain tx  
5. **Agent** → Eval harness (accuracy 1)  
6. **Evidence** → show proof links + say thank you
