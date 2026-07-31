# Arb Guardian

<p align="center">
  <img src="docs/assets/logo-readme.png" alt="Arb Guardian" width="148" />
</p>

<p align="center">
  <strong>Guild bank protection for gaming teams</strong><br/>
  Review spends before anyone signs. Block scams. Freeze when it matters.
</p>

<p align="center">
  <a href="https://arb-guardian.vercel.app"><img src="https://img.shields.io/badge/Live_app-E5FF5D?style=for-the-badge&labelColor=0B1220" alt="Live app" /></a>
  <img src="https://img.shields.io/badge/Category-Gaming-28A0F0?style=for-the-badge&labelColor=0B1220" alt="Gaming" />
</p>

**Live:** [arb-guardian.vercel.app](https://arb-guardian.vercel.app)

## Product

Arb Guardian helps guild officers protect a shared prize pot: check a spend, get Allow/Block from bounded Officer AI, and freeze spending with a human click. Live on Arbitrum Sepolia and Robinhood Chain.

## Docs

- [`docs/architecture.md`](docs/architecture.md) — system design  
- [`docs/live-deployment.md`](docs/live-deployment.md) — contract addresses  
- [`docs/agent-permissions-matrix.md`](docs/agent-permissions-matrix.md) — Officer AI bounds  

```bash
npm install
npm run quality:gate
npm run dev -w apps/web
```

## License

MIT
