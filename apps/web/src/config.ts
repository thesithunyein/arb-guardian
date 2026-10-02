export const CHAIN_NAME = import.meta.env.VITE_CHAIN_NAME?.trim() || "Arbitrum Sepolia";
/** Set this to the verified Vercel custom-domain URL when the domain is attached. */
export const PUBLIC_APP_URL =
  import.meta.env.VITE_PUBLIC_APP_URL?.trim() || "https://arb-guardian.sithunyein.com";
export const CHAIN_ID = 421614;
export const RPC_URL =
  import.meta.env.VITE_ARB_SEPOLIA_RPC_URL?.trim() || "https://sepolia-rollup.arbitrum.io/rpc";
export const EXPLORER = "https://sepolia.arbiscan.io";

/** Recorded Arbitrum Sepolia deployment (public, onchain; superseded by the current source). */
export const POLICY_MANAGER =
  import.meta.env.VITE_POLICY_MANAGER_ADDRESS?.trim() ||
  "0x3e394b1d9781a71D71905d028C530B29Aa0021a6";
export const EXECUTION_GUARD =
  import.meta.env.VITE_EXECUTION_GUARD_ADDRESS?.trim() ||
  "0x5e60F2D4E3F50eA16Ed0413e718535d720c3D5cC";
export const SAFE_TREASURY_GUARD =
  import.meta.env.VITE_SAFE_TREASURY_GUARD_ADDRESS?.trim() ||
  "0x01b03b1e0E20F84a9Fa832AbeB58283e30cA2F1b";
export const TREASURY_SAFE =
  import.meta.env.VITE_TREASURY_SAFE_ADDRESS?.trim() ||
  "0x5769B6973cF7E85acfa7590763549bfCf80Cbb82";
export const POLICY_MANAGER_TX =
  import.meta.env.VITE_POLICY_MANAGER_TX?.trim() ||
  "0xcf05d7550a84f8f9025d72f1a1ff6a48b56e2f6244e7b28c359b66ec5c8dd02d";
export const EXECUTION_GUARD_TX =
  import.meta.env.VITE_EXECUTION_GUARD_TX?.trim() ||
  "0x23f446d300ea4c6cfaf39191d95091ff7be5a06e32c6482354eac3a03b59dd86";
export const SAFE_TREASURY_GUARD_TX =
  import.meta.env.VITE_SAFE_TREASURY_GUARD_TX?.trim() ||
  "0x8cf1615ca6849bfef4fc3b33ba554a28d8cddb8459b25c3191970d579563eff6";
export const TREASURY_SAFE_TX =
  import.meta.env.VITE_TREASURY_SAFE_TX?.trim() ||
  "0x53267ccaa5b33b4bceb07d251439f479cd3612714c2f524ee191bb09b61913b9";
export const SAFE_ENROLLMENT_TX =
  import.meta.env.VITE_SAFE_ENROLLMENT_TX?.trim() ||
  "0x640eeb856ec43cf2fd135e99111bfb112abb6f54f3e8710f50836a9dcc7ab4d8";
export const SAFE_SET_GUARD_TX =
  import.meta.env.VITE_SAFE_SET_GUARD_TX?.trim() ||
  "0x98dc84c456e81c554ba22a137ac85b6b79da160288fdb796cb9ab8c1d295c907";
export const SAFE_ALLOWED_EXEC_TX =
  import.meta.env.VITE_SAFE_ALLOWED_EXEC_TX?.trim() ||
  "0x1313db311ce1e99b3623c4b42e6d6f1e531f40bc3e7032f88c68a790343ba216";
/**
 * The refusal, as a transaction.
 *
 * Gas estimation would reject this send before it reached the network, so the enrollment sends it
 * with a supplied gas limit: it is mined, reverts inside the guard, and keeps a hash. A block a
 * judge can open beats a block that only ever existed in a log.
 */
export const SAFE_BLOCKED_EXEC_TX =
  import.meta.env.VITE_SAFE_BLOCKED_EXEC_TX?.trim() ||
  "0xff26308871c5b7c36b477940dc1b7307f8fdbbd979190ef89760b86902a99524";

/** Robinhood Chain Testnet (Overall reserved-lane proof). */
export const RH_EXPLORER = "https://explorer.testnet.chain.robinhood.com";
export const RH_CHAIN_ID = 46630;
export const RH_POLICY_MANAGER =
  import.meta.env.VITE_RH_POLICY_MANAGER_ADDRESS?.trim() ||
  "0x3E4a51B35a984f33D4F71CEf96Eb8f08fcC8Ef2b";
export const RH_EXECUTION_GUARD =
  import.meta.env.VITE_RH_EXECUTION_GUARD_ADDRESS?.trim() ||
  "0xD1bbF5e71295696B2011408eAa13dEb69adcD21D";
export const RH_SAFE_TREASURY_GUARD =
  import.meta.env.VITE_RH_SAFE_TREASURY_GUARD_ADDRESS?.trim() ||
  "0xe10afE3da5546fc0F34c6F38DB3920BD5f5C6999";
export const RH_TREASURY_SAFE =
  import.meta.env.VITE_RH_TREASURY_SAFE_ADDRESS?.trim() ||
  "0x8D9540796444ded4dA17fC0FA38CcBb9a701991a";
export const RH_POLICY_MANAGER_TX =
  import.meta.env.VITE_RH_POLICY_MANAGER_TX?.trim() ||
  "0x732c69171fe297bec508384384aac2d7b3574c1394f40be42bacd8f6bd835a54";
export const RH_EXECUTION_GUARD_TX =
  import.meta.env.VITE_RH_EXECUTION_GUARD_TX?.trim() ||
  "0xaba91ef8432d20c0a81e98985afd3678c87629cb9b5c7ce7ef93e0b1190fa802";
export const RH_SAFE_TREASURY_GUARD_TX =
  import.meta.env.VITE_RH_SAFE_TREASURY_GUARD_TX?.trim() ||
  "0x20a8b36afa59c6c7dcc7b3a35630c838e025dc4884cd7ef2cfe0ab258a7d488a";
export const RH_TREASURY_SAFE_TX =
  import.meta.env.VITE_RH_TREASURY_SAFE_TX?.trim() ||
  "0xb10a404f19aa129155ec4518f3db29980fb6318bf487cf827c0dc2ee75896f8f";
export const RH_SAFE_SET_GUARD_TX =
  import.meta.env.VITE_RH_SAFE_SET_GUARD_TX?.trim() ||
  "0x64240c9782c7bead68997536063c0cc029bc1df9e46d5551c69af2449f2c73a3";
export const RH_SAFE_ALLOWED_EXEC_TX =
  import.meta.env.VITE_RH_SAFE_ALLOWED_EXEC_TX?.trim() ||
  "0xb7f97778c85b99e3188bdb75258fd351ff873a055896ea4781e1363a7ae643c8";
export const RH_SAFE_BLOCKED_EXEC_TX =
  import.meta.env.VITE_RH_SAFE_BLOCKED_EXEC_TX?.trim() ||
  "0x44e08cf915f90b7394eb0be18cd10ac44399e2e685f47821ebbd639d1412f515";
export const RH_READY = /^0x[a-fA-F0-9]{40}$/.test(RH_POLICY_MANAGER) && /^0x[a-fA-F0-9]{40}$/.test(RH_EXECUTION_GUARD);

/**
 * Paxos USDG (Global Dollar) on each lane this project deploys to.
 *
 * These are the issuer's published testnet addresses, and `npm run check:settlement` reads
 * `symbol()` and `decimals()` at both to confirm they are what the manifest declares. The
 * decimals are the part that matters: a token lane configured with the wrong scale misreads every
 * cap by a power of ten, which no amount of reading the code will reveal.
 */
export const USDG =
  import.meta.env.VITE_USDG_ADDRESS?.trim() || "0xFFC95faa3d63Cde504a05B567C600B78C0b41892";
export const RH_USDG =
  import.meta.env.VITE_RH_USDG_ADDRESS?.trim() || "0x7E955252E15c84f5768B83c41a71F9eba181802F";
export const USDG_DECIMALS = 6;

/** Same-origin Vercel serverless API by default. */
export const API_BASE = import.meta.env.VITE_API_BASE_URL?.trim() || "/api";
export const API_KEY = import.meta.env.VITE_API_KEY?.trim() || undefined;

export const addressUrl = (addr: string) => `${EXPLORER}/address/${addr}`;
export const txUrl = (hash: string) => `${EXPLORER}/tx/${hash}`;
export const rhAddressUrl = (addr: string) => `${RH_EXPLORER}/address/${addr}`;
export const rhTxUrl = (hash: string) => `${RH_EXPLORER}/tx/${hash}`;

export const DEPLOYMENT_READY =
  import.meta.env.VITE_DEPLOYMENT_STATUS?.trim() === "current" &&
  /^0x[a-fA-F0-9]{40}$/.test(POLICY_MANAGER) &&
  /^0x[a-fA-F0-9]{40}$/.test(EXECUTION_GUARD);
