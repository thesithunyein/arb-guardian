export const CHAIN_NAME = import.meta.env.VITE_CHAIN_NAME?.trim() || "Arbitrum Sepolia";
export const CHAIN_ID = 421614;
export const RPC_URL =
  import.meta.env.VITE_ARB_SEPOLIA_RPC_URL?.trim() || "https://sepolia-rollup.arbitrum.io/rpc";
export const EXPLORER = "https://sepolia.arbiscan.io";

/** Live Arbitrum Sepolia deployment (public, onchain). */
export const POLICY_MANAGER =
  import.meta.env.VITE_POLICY_MANAGER_ADDRESS?.trim() ||
  "0x57077DA6DEFCAAB83aEAbE080641D5D1Ed66758F";
export const EXECUTION_GUARD =
  import.meta.env.VITE_EXECUTION_GUARD_ADDRESS?.trim() ||
  "0x4019C445bbc593eA5eb13D319Ca427aA8aDc7613";
export const POLICY_MANAGER_TX =
  import.meta.env.VITE_POLICY_MANAGER_TX?.trim() ||
  "0xefab9b6deda8a1556eab898878b121dae2502172ddb2b2f956fc68921743967c";
export const EXECUTION_GUARD_TX =
  import.meta.env.VITE_EXECUTION_GUARD_TX?.trim() ||
  "0xb3c8b3a866a1f0cf8f9bcfcd29389fe4bc42131fcb9866cd7dc9ac5624819ec9";

export const API_BASE = import.meta.env.VITE_API_BASE_URL?.trim() || "";
export const API_KEY = import.meta.env.VITE_API_KEY?.trim() || undefined;

export const addressUrl = (addr: string) => `${EXPLORER}/address/${addr}`;
export const txUrl = (hash: string) => `${EXPLORER}/tx/${hash}`;

export const DEPLOYMENT_READY =
  /^0x[a-fA-F0-9]{40}$/.test(POLICY_MANAGER) && /^0x[a-fA-F0-9]{40}$/.test(EXECUTION_GUARD);
