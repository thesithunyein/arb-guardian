# Arb Guardian

<p align="center">
  <img src="docs/assets/logo-readme.png" alt="Arb Guardian" width="148" />
</p>

<p align="center">
  <strong>The most fun way to protect your guild bank</strong><br/>
  Check spends like quests · stop marketplace drains · keep prize budgets · freeze with an officer click
</p>

<p align="center">
  <a href="https://arb-guardian.vercel.app"><img src="https://img.shields.io/badge/▶_Play_live-E5FF5D?style=for-the-badge&labelColor=0B1220" alt="Play live" /></a>
  <img src="https://img.shields.io/badge/Built_for-Guild_officers-28A0F0?style=for-the-badge&labelColor=0B1220" alt="Guild officers" />
  <img src="https://img.shields.io/badge/Networks-Arbitrum_+_Robinhood-CCFF00?style=for-the-badge&labelColor=0B1220" alt="Networks" />
</p>

---

## What it is

**Arb Guardian** is a guild-bank protection app for gamers, clan managers, and esports orgs.

Your shared prize pot stays behind clear rules. Officers check a spend, earn XP when they protect the bank, and freeze spending when something looks wrong — without needing an explorer open in another tab.

**Play now → [arb-guardian.vercel.app](https://arb-guardian.vercel.app)**

## Who it’s for

- Guild officers who sign the bank wallet  
- Clan / esports managers paying contributors  
- Communities holding a shared prize pot  

## What you can do

| Move | Result |
| --- | --- |
| **Start a quest** | Check unknown marketplace approvals or payouts |
| **Earn XP** | Real protection actions level you up and unlock badges |
| **Open Alerts** | Shared queue for the officer team |
| **Freeze the bank** | Stop spending after a hit — human click required |
| **Guild assets** | See prize pot, budget, allowlist, and freeze status like inventory |

## How a session feels

1. **Press start** — title screen only, no feature dump  
2. **Pick a quest** — marketplace scam, over budget, or clean payout  
3. **Get a clear result** — allow, hold, or block  
4. **Act from Alerts** — acknowledge, freeze, or dismiss  
5. **Keep progress** — XP and badges stay on your device  

## Under the hood (for builders)

Protection is enforced onchain — allowlists, daily limits, spend guards, and an officer-gated pause — on **Arbitrum Sepolia** and **Robinhood Chain** testnet.

| Network | Policy | Spend guard |
| --- | --- | --- |
| Arbitrum Sepolia | [`0x4f3d…Cf76`](https://sepolia.arbiscan.io/address/0x4f3dC29Ed0c8844E31fD84c3eE22C1C94158Cf76) | [`0x10fb…6124`](https://sepolia.arbiscan.io/address/0x10fbe21ccb611A2aBF12a784C67278eAf6dE6124) |
| Robinhood Testnet | [`0x5707…758F`](https://explorer.testnet.chain.robinhood.com/address/0x57077DA6DEFCAAB83aEAbE080641D5D1Ed66758F) | [`0x4019…7613`](https://explorer.testnet.chain.robinhood.com/address/0x4019C445bbc593eA5eb13D319Ca427aA8aDc7613) |

Full deploy notes live in [`docs/live-deployment.md`](docs/live-deployment.md).

```bash
npm install
npm run dev -w apps/web
```

## Brand

| Token | Value |
| --- | --- |
| Night | `#0B1220` |
| Lime CTA | `#E5FF5D` |
| Fonts | Pixelify Sans + Mulish |

## License

MIT
