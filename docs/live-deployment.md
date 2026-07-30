# Live deployment (Arbitrum Sepolia)

Public, onchain qualification proof for Arb Guardian.

| Field | Value |
| --- | --- |
| Network | Arbitrum Sepolia |
| Chain ID | 421614 |
| PolicyManager | [`0x4f3dC29Ed0c8844E31fD84c3eE22C1C94158Cf76`](https://sepolia.arbiscan.io/address/0x4f3dC29Ed0c8844E31fD84c3eE22C1C94158Cf76) |
| ExecutionGuard | [`0x10fbe21ccb611A2aBF12a784C67278eAf6dE6124`](https://sepolia.arbiscan.io/address/0x10fbe21ccb611A2aBF12a784C67278eAf6dE6124) |
| SafeTreasuryGuard | [`0xcba30F60BE3FB0fB0e9db0C816c4ab9Fa2f7b211`](https://sepolia.arbiscan.io/address/0xcba30F60BE3FB0fB0e9db0C816c4ab9Fa2f7b211) |
| Treasury Safe (enrolled) | [`0x009D53F97a07d9E141eA5ff90354d7bE748fa542`](https://sepolia.arbiscan.io/address/0x009D53F97a07d9E141eA5ff90354d7bE748fa542) |
| PolicyManager tx | [`0x9400…afc2`](https://sepolia.arbiscan.io/tx/0x9400d2f97914093c516c38242d86d6368d4e352dc867cc9ef735a6c6bd00afc2) |
| ExecutionGuard tx | [`0xad9c…c1a0`](https://sepolia.arbiscan.io/tx/0xad9c6ca6b58c06e10b34701776cf135d97cb5c11a534ce02bb781df189afc1a0) |
| SafeTreasuryGuard tx | [`0x809c…3f1b`](https://sepolia.arbiscan.io/tx/0x809ca1051a8997a307c8e9d0bc66348e01eb51c45564e6425fb59c9fa14c3f1b) |
| setGuard tx | [`0xb2c4…aacf`](https://sepolia.arbiscan.io/tx/0xb2c4aea1168ea84acba7d00b35642eec75522e76d5228f75db73540e300caacf) |
| Enrollment tx | [`0x5473…28ef`](https://sepolia.arbiscan.io/tx/0x5473cda2369d024b1f802998f64fa6ee5ccf15dc7e6d617052ddae5f89cb28ef) |
| Allowed Safe exec tx | [`0xd4ec…978a`](https://sepolia.arbiscan.io/tx/0xd4ec25f77a9ea06d053997ea2d7e68e87a91518f8fa4d7b60618d2ca80a6978a) |
| Live product | https://arb-guardian.vercel.app |
| Repository | https://github.com/thesithunyein/arb-guardian |

## Integration notes

- `ExecutionGuard` — operator/API pre-execution validation path
- `SafeTreasuryGuard` — Gnosis Safe–compatible `ITransactionGuard`
- `TreasurySafeShell` — enrolled 1-of-1 treasury wallet with `setGuard` + live allow/block proof txs

This file is safe to commit (no secrets — addresses and tx hashes only).
