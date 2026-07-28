/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_API_KEY?: string;
  readonly VITE_POLICY_MANAGER_ADDRESS?: string;
  readonly VITE_EXECUTION_GUARD_ADDRESS?: string;
  readonly VITE_CHAIN_NAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
