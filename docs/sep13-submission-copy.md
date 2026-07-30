# Sep 13 submission copy (max-win)

## Tracks
- Overall Prize (Arbitrum lane + Robinhood lane both covered)
- Best Agentic Project

## Market category
**Gaming** — guild bank / prize-pot protection with practice spends and Officer AI (not a playable mini-game).

## One sentence
Arb Guardian is a Gaming product for guild officers: check spends before anyone signs, get a clear allow/block from bounded Officer AI, and freeze the bank with a human click — live on Arbitrum Sepolia and Robinhood Chain.

## Links
- Live: https://arb-guardian.vercel.app
- Repo: https://github.com/thesithunyein/arb-guardian
- Demo video: _(paste Unlisted URL after recording)_

## Official criteria map
1. **Smart contract quality** — RBAC, Pausable, allowlist, daily limits, ExecutionGuard, SafeTreasuryGuard; tests via `npm run quality:gate`
2. **Product-Market Fit** — Practice-first Check → Alert → Freeze officers finish in under a minute
3. **Innovation** — Gaming UX × deterministic rules × bounded Officer AI (cannot move funds)
4. **Real Problem Solving** — Unknown marketplace approve drains + over-budget prize payouts + shared freeze log
5. **Arb reserved lane** — Live Sepolia contracts in Vault
6. **RH reserved lane** — Live Robinhood testnet twin in Vault

## Arbitrum Sepolia
- PolicyManager: `0x4f3dC29Ed0c8844E31fD84c3eE22C1C94158Cf76`
- ExecutionGuard: `0x10fbe21ccb611A2aBF12a784C67278eAf6dE6124`
- SafeTreasuryGuard: `0xcba30F60BE3FB0fB0e9db0C816c4ab9Fa2f7b211`
- Treasury Safe: `0x009D53F97a07d9E141eA5ff90354d7bE748fa542`

## Robinhood Chain Testnet
- PolicyManager: `0x57077DA6DEFCAAB83aEAbE080641D5D1Ed66758F`
- ExecutionGuard: `0x4019C445bbc593eA5eb13D319Ca427aA8aDc7613`
- SafeTreasuryGuard: `0xa168227dB7a3340e988Dbf9Cd01894840617E729`
- Treasury Safe: `0x10fbe21ccb611A2aBF12a784C67278eAf6dE6124`
- Explorer: https://explorer.testnet.chain.robinhood.com
