# Live deployment

Public onchain qualification proof for Arb Guardian.

## Arbitrum Sepolia (primary)

| Field | Value |
| --- | --- |
| Network | Arbitrum Sepolia |
| Chain ID | 421614 |
| PolicyManager | [`0x4f3dC29Ed0c8844E31fD84c3eE22C1C94158Cf76`](https://sepolia.arbiscan.io/address/0x4f3dC29Ed0c8844E31fD84c3eE22C1C94158Cf76) |
| ExecutionGuard | [`0x10fbe21ccb611A2aBF12a784C67278eAf6dE6124`](https://sepolia.arbiscan.io/address/0x10fbe21ccb611A2aBF12a784C67278eAf6dE6124) |
| SafeTreasuryGuard | [`0xcba30F60BE3FB0fB0e9db0C816c4ab9Fa2f7b211`](https://sepolia.arbiscan.io/address/0xcba30F60BE3FB0fB0e9db0C816c4ab9Fa2f7b211) |
| Treasury Safe (enrolled) | [`0x009D53F97a07d9E141eA5ff90354d7bE748fa542`](https://sepolia.arbiscan.io/address/0x009D53F97a07d9E141eA5ff90354d7bE748fa542) |
| Live product | https://arb-guardian.vercel.app |
| Repository | https://github.com/thesithunyein/arb-guardian |

## Robinhood Chain Testnet (Overall reserved-lane)

| Field | Value |
| --- | --- |
| Network | Robinhood Chain Testnet |
| Chain ID | 46630 |
| RPC | `https://rpc.testnet.chain.robinhood.com` |
| Explorer | https://explorer.testnet.chain.robinhood.com |
| PolicyManager | [`0x57077DA6DEFCAAB83aEAbE080641D5D1Ed66758F`](https://explorer.testnet.chain.robinhood.com/address/0x57077DA6DEFCAAB83aEAbE080641D5D1Ed66758F) |
| ExecutionGuard | [`0x4019C445bbc593eA5eb13D319Ca427aA8aDc7613`](https://explorer.testnet.chain.robinhood.com/address/0x4019C445bbc593eA5eb13D319Ca427aA8aDc7613) |
| SafeTreasuryGuard | [`0xa168227dB7a3340e988Dbf9Cd01894840617E729`](https://explorer.testnet.chain.robinhood.com/address/0xa168227dB7a3340e988Dbf9Cd01894840617E729) |
| Treasury Safe (enrolled) | [`0x10fbe21ccb611A2aBF12a784C67278eAf6dE6124`](https://explorer.testnet.chain.robinhood.com/address/0x10fbe21ccb611A2aBF12a784C67278eAf6dE6124) |
| Status | Deployed 2026-07-30T14:52:40.069Z |

## Integration notes

- `ExecutionGuard` — operator/API pre-execution validation
- `SafeTreasuryGuard` — Safe-compatible `ITransactionGuard`
- Dual-chain deploy supports Arbitrum qualification **and** Robinhood reserved Overall lane
