import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export type DeploymentStatus = {
  ready: boolean;
  network: string | null;
  policyManager: string | null;
  executionGuard: string | null;
  source: "env" | "local-file" | "none";
};

function readLocalLatest(): Partial<{
  network: string;
  policyManager: { address: string };
  executionGuard: { address: string };
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
    return {
      ready: true,
      network: process.env.SUBMISSION_NETWORK?.trim() || "Arbitrum Sepolia",
      policyManager: fromEnvPolicy,
      executionGuard: fromEnvGuard,
      source: "env"
    };
  }

  const local = readLocalLatest();
  if (local?.policyManager?.address && local?.executionGuard?.address) {
    return {
      ready: true,
      network: local.network ?? "local",
      policyManager: local.policyManager.address,
      executionGuard: local.executionGuard.address,
      source: "local-file"
    };
  }

  return {
    ready: false,
    network: null,
    policyManager: null,
    executionGuard: null,
    source: "none"
  };
}
