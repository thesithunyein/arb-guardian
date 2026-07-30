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
export const POLICY_MANAGER_TX =
  import.meta.env.VITE_POLICY_MANAGER_TX?.trim() ||
  "0x9400d2f97914093c516c38242d86d6368d4e352dc867cc9ef735a6c6bd00afc2";
export const EXECUTION_GUARD_TX =
  import.meta.env.VITE_EXECUTION_GUARD_TX?.trim() ||
  "0xad9c6ca6b58c06e10b34701776cf135d97cb5c11a534ce02bb781df189afc1a0";
export const SAFE_TREASURY_GUARD_TX =
  import.meta.env.VITE_SAFE_TREASURY_GUARD_TX?.trim() ||
  "0x809ca1051a8997a307c8e9d0bc66348e01eb51c45564e6425fb59c9fa14c3f1b";

/** Same-origin Vercel serverless API by default. */
export const API_BASE = import.meta.env.VITE_API_BASE_URL?.trim() || "/api";
export const API_KEY = import.meta.env.VITE_API_KEY?.trim() || undefined;

export const addressUrl = (addr: string) => `${EXPLORER}/address/${addr}`;
export const txUrl = (hash: string) => `${EXPLORER}/tx/${hash}`;

export const DEPLOYMENT_READY =
  /^0x[a-fA-F0-9]{40}$/.test(POLICY_MANAGER) && /^0x[a-fA-F0-9]{40}$/.test(EXECUTION_GUARD);
