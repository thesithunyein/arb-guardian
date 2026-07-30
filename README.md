# Arb Guardian

<p align="center">
  <img src="docs/assets/logo-readme.png" alt="Arb Guardian" width="148" />
</p>

<p align="center">
  <strong>The most fun way to protect your guild bank</strong><br/>
  Your guild shares one bank. Fake shops try to drain it. Check spends before anyone signs.
</p>

<p align="center">
  <a href="https://arb-guardian.vercel.app"><img src="https://img.shields.io/badge/▶_Play_live-E5FF5D?style=for-the-badge&labelColor=0B1220" alt="Play live" /></a>
  <img src="https://img.shields.io/badge/Category-Gaming-28A0F0?style=for-the-badge&labelColor=0B1220" alt="Gaming" />
</p>

---

## Launch loop (60 seconds)

1. **Press start**  
2. **Check spend** — unknown marketplace approval  
3. **Block** — Officer AI suggests freeze (cannot move funds)  
4. **Alerts → Freeze** — human click  
5. **Live networks** — Arbitrum + Robinhood explorers  

**Play → [arb-guardian.vercel.app](https://arb-guardian.vercel.app)** · Practice mode · no wallet needed to try

## How it works

```mermaid
flowchart LR
  A[Someone asks the bank to pay] --> B[Officer checks the spend]
  B --> C{Safe?}
  C -->|Yes| D[Allow]
  C -->|No| E[Block + Officer AI suggestion]
  E --> F[Officer freezes the bank]
```

## Who it’s for

Guild officers, clan managers, and esports teams that share a prize pot.

## For builders

- [`docs/architecture.md`](docs/architecture.md) — system design  
- [`docs/live-deployment.md`](docs/live-deployment.md) — Arbitrum + Robinhood addresses  
- [`docs/agent-permissions-matrix.md`](docs/agent-permissions-matrix.md) — Officer AI bounds  
- [`docs/demo-video-script.md`](docs/demo-video-script.md) — 90s demo  

```bash
npm install
npm run quality:gate
npm run dev -w apps/web
```

## License

MIT
