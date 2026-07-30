import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export type DeploymentStatus = {
  ready: boolean;
  network: string | null;
  chainId: number | null;
  policyManager: string | null;
  executionGuard: string | null;
  policyManagerTx: string | null;
  executionGuardTx: string | null;
  policyManagerTxUrl: string | null;
  executionGuardTxUrl: string | null;
  policyManagerUrl: string | null;
  executionGuardUrl: string | null;
  source: "env" | "local-file" | "none";
};

function explorerBaseUrl(network: string | null): string {
  if (network === "arbitrumSepolia" || network === "Arbitrum Sepolia") {
    return "https://sepolia.arbiscan.io";
  }
  return process.env.SUBMISSION_EXPLORER_BASE_URL?.replace(/\/tx\/?$/, "") ?? "https://sepolia.arbiscan.io";
}

function buildDeploymentStatus(
  network: string,
  chainId: number | null,
  policyManager: string,
  executionGuard: string,
  policyManagerTx: string | null,
  executionGuardTx: string | null,
  source: "env" | "local-file"
): DeploymentStatus {
  const explorer = explorerBaseUrl(network);
  return {
    ready: true,
    network,
    chainId,
    policyManager,
    executionGuard,
    policyManagerTx,
    executionGuardTx,
    policyManagerTxUrl: policyManagerTx ? `${explorer}/tx/${policyManagerTx}` : null,
    executionGuardTxUrl: executionGuardTx ? `${explorer}/tx/${executionGuardTx}` : null,
    policyManagerUrl: `${explorer}/address/${policyManager}`,
    executionGuardUrl: `${explorer}/address/${executionGuard}`,
    source
  };
}

function readLocalLatest(): Partial<{
  network: string;
  chainId: number;
  policyManager: { address: string; txHash?: string };
  executionGuard: { address: string; txHash?: string };
}> | null {
  const candidates = [
    resolve(process.cwd(), "../../packages/contracts/deployments/latest.json"),
    resolve(process.cwd(), "packages/contracts/deployments/latest.json"),
    resolve(process.cwd(), "deployments/latest.json")
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      return JSON.parse(readFileSync(path, "utf8"));
    } catch {
      return null;
    }
  }
  return null;
}

export function getDeploymentStatus(): DeploymentStatus {
  const fromEnvPolicy = process.env.SUBMISSION_POLICY_MANAGER_ADDRESS?.trim() || null;
  const fromEnvGuard = process.env.SUBMISSION_EXECUTION_GUARD_ADDRESS?.trim() || null;
  if (fromEnvPolicy && fromEnvGuard) {
    return buildDeploymentStatus(
      process.env.SUBMISSION_NETWORK?.trim() || "Arbitrum Sepolia",
      Number(process.env.SUBMISSION_CHAIN_ID ?? "421614"),
      fromEnvPolicy,
      fromEnvGuard,
      process.env.SUBMISSION_POLICY_MANAGER_TX?.trim() || null,
      process.env.SUBMISSION_EXECUTION_GUARD_TX?.trim() || null,
      "env"
    );
  }

  const local = readLocalLatest();
  if (local?.policyManager?.address && local?.executionGuard?.address) {
    const isSepolia = local.network === "arbitrumSepolia" || local.chainId === 421614;
    return buildDeploymentStatus(
      isSepolia ? "Arbitrum Sepolia" : (local.network ?? "local"),
      local.chainId ?? null,
      local.policyManager.address,
      local.executionGuard.address,
      local.policyManager.txHash ?? null,
      local.executionGuard.txHash ?? null,
      "local-file"
    );
  }

  return {
    ready: false,
    network: null,
    chainId: null,
    policyManager: null,
    executionGuard: null,
    policyManagerTx: null,
    executionGuardTx: null,
    policyManagerTxUrl: null,
    executionGuardTxUrl: null,
    policyManagerUrl: null,
    executionGuardUrl: null,
    source: "none"
  };
}
