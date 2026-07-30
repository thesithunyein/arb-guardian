/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_API_KEY?: string;
  readonly VITE_POLICY_MANAGER_ADDRESS?: string;
  readonly VITE_EXECUTION_GUARD_ADDRESS?: string;
  readonly VITE_SAFE_TREASURY_GUARD_ADDRESS?: string;
  readonly VITE_TREASURY_SAFE_ADDRESS?: string;
  readonly VITE_POLICY_MANAGER_TX?: string;
  readonly VITE_EXECUTION_GUARD_TX?: string;
  readonly VITE_SAFE_TREASURY_GUARD_TX?: string;
  readonly VITE_TREASURY_SAFE_TX?: string;
  readonly VITE_SAFE_ENROLLMENT_TX?: string;
  readonly VITE_SAFE_SET_GUARD_TX?: string;
  readonly VITE_SAFE_ALLOWED_EXEC_TX?: string;
  readonly VITE_RH_POLICY_MANAGER_ADDRESS?: string;
  readonly VITE_RH_EXECUTION_GUARD_ADDRESS?: string;
  readonly VITE_RH_SAFE_TREASURY_GUARD_ADDRESS?: string;
  readonly VITE_RH_TREASURY_SAFE_ADDRESS?: string;
  readonly VITE_RH_POLICY_MANAGER_TX?: string;
  readonly VITE_RH_EXECUTION_GUARD_TX?: string;
  readonly VITE_RH_SAFE_TREASURY_GUARD_TX?: string;
  readonly VITE_RH_TREASURY_SAFE_TX?: string;
  readonly VITE_CHAIN_NAME?: string;
  readonly VITE_ARB_SEPOLIA_RPC_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
