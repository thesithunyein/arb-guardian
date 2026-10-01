# Sep 13 submission copy (max-win)

## Tracks
- Overall Prize (Arbitrum lane + Robinhood lane both covered)
- Promising Products

## Market category
**Treasury / on-chain infrastructure** — enforceable spend policy for delegated funds (agents, bots,
operators). Guild and esports prize pots are one application, not the identity.

## One sentence
Arb Guardian lets a treasury delegate funds to an agent, bot or operator without delegating the
ability to drain the account: allowlists and daily caps in native ETH **and USDG** are enforced by
a real Gnosis Safe transaction guard, with a human freeze on top — live on Arbitrum Sepolia and
Robinhood Chain.

## Links
- Live: https://arb-guardian.vercel.app
- Repo: https://github.com/thesithunyein/arb-guardian
- Demo video: _(paste Unlisted URL after recording)_

## Official criteria map
1. **Smart contract quality** — RBAC, Pausable, deny-by-default limits in both lanes, calldata-aware token routing, real Gnosis Safe v1.4.1 integration, spend refunded on failure; 57 tests via `npm run quality:gate`
2. **Product-Market Fit** — the control every team delegating funds needs, denominated in the asset treasuries hold (USDG first), on the chain where those teams are being pointed
3. **Innovation** — contract-enforced delegated-spend policy: unlimited approvals refused, unrecognised calls on registered tokens rejected, no vendor goodwill or application code in the trust path
4. **Real Problem Solving** — delegated trust is currently all-or-nothing; $13.3M of buyer losses on Robinhood Chain in one crew's 56 launches, $9.4M of it from app users who never saw an on-chain flag (Bitquery, Sept 2026)
5. **Paxos USDG** — first-class token lane, denominated correctly in USDG's 6-decimal base units
6. **Arb reserved lane** — live Sepolia contracts in Vault
7. **RH reserved lane** — live Robinhood testnet twin in Vault
8. **Proof, not a demo** — `npm run evidence -w packages/contracts` reproduces 14/14 cases against a real Safe, with a before/after pair and exact revert reasons

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
