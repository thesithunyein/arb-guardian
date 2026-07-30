export const CHAIN_NAME = import.meta.env.VITE_CHAIN_NAME?.trim() || "Arbitrum Sepolia";
export const CHAIN_ID = 421614;
export const RPC_URL =
  import.meta.env.VITE_ARB_SEPOLIA_RPC_URL?.trim() || "https://sepolia-rollup.arbitrum.io/rpc";
export const EXPLORER = "https://sepolia.arbiscan.io";

/** Live Arbitrum Sepolia deployment (public, onchain). */
export const POLICY_MANAGER =
  import.meta.env.VITE_POLICY_MANAGER_ADDRESS?.trim() ||
  "0x4f3dC29Ed0c8844E31fD84c3eE22C1C94158Cf76";
export const EXECUTION_GUARD =
  import.meta.env.VITE_EXECUTION_GUARD_ADDRESS?.trim() ||
  "0x10fbe21ccb611A2aBF12a784C67278eAf6dE6124";
export const SAFE_TREASURY_GUARD =
  import.meta.env.VITE_SAFE_TREASURY_GUARD_ADDRESS?.trim() ||
  "0xcba30F60BE3FB0fB0e9db0C816c4ab9Fa2f7b211";
export const TREASURY_SAFE =
  import.meta.env.VITE_TREASURY_SAFE_ADDRESS?.trim() ||
  "0x009D53F97a07d9E141eA5ff90354d7bE748fa542";
export const POLICY_MANAGER_TX =
  import.meta.env.VITE_POLICY_MANAGER_TX?.trim() ||
  "0x9400d2f97914093c516c38242d86d6368d4e352dc867cc9ef735a6c6bd00afc2";
export const EXECUTION_GUARD_TX =
  import.meta.env.VITE_EXECUTION_GUARD_TX?.trim() ||
  "0xad9c6ca6b58c06e10b34701776cf135d97cb5c11a534ce02bb781df189afc1a0";
export const SAFE_TREASURY_GUARD_TX =
  import.meta.env.VITE_SAFE_TREASURY_GUARD_TX?.trim() ||
  "0x809ca1051a8997a307c8e9d0bc66348e01eb51c45564e6425fb59c9fa14c3f1b";
export const TREASURY_SAFE_TX =
  import.meta.env.VITE_TREASURY_SAFE_TX?.trim() ||
  "0x384e35c4da7e667f8a6887af50a8dbb0e8b1f4cc7c787d6179c4b043993b39d5";
export const SAFE_ENROLLMENT_TX =
  import.meta.env.VITE_SAFE_ENROLLMENT_TX?.trim() ||
  "0x5473cda2369d024b1f802998f64fa6ee5ccf15dc7e6d617052ddae5f89cb28ef";
export const SAFE_SET_GUARD_TX =
  import.meta.env.VITE_SAFE_SET_GUARD_TX?.trim() ||
  "0xb2c4aea1168ea84acba7d00b35642eec75522e76d5228f75db73540e300caacf";
export const SAFE_ALLOWED_EXEC_TX =
  import.meta.env.VITE_SAFE_ALLOWED_EXEC_TX?.trim() ||
  "0xd4ec25f77a9ea06d053997ea2d7e68e87a91518f8fa4d7b60618d2ca80a6978a";

/** Same-origin Vercel serverless API by default. */
export const API_BASE = import.meta.env.VITE_API_BASE_URL?.trim() || "/api";
export const API_KEY = import.meta.env.VITE_API_KEY?.trim() || undefined;

export const addressUrl = (addr: string) => `${EXPLORER}/address/${addr}`;
export const txUrl = (hash: string) => `${EXPLORER}/tx/${hash}`;

export const DEPLOYMENT_READY =
  /^0x[a-fA-F0-9]{40}$/.test(POLICY_MANAGER) && /^0x[a-fA-F0-9]{40}$/.test(EXECUTION_GUARD);
