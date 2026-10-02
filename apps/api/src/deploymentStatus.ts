import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export type DeploymentStatus = {
  ready: boolean;
  status: "current" | "superseded" | "unknown";
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
  source: "env" | "local-file" | "live-manifest" | "none";
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
  source: DeploymentStatus["source"],
  status: DeploymentStatus["status"]
): DeploymentStatus {
  const explorer = explorerBaseUrl(network);
  return {
    ready: status === "current",
    status,
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
  // Tests set this so they never write into the directory the running product reads. A test
  // that leaves a half-written `latest.json` behind in the real path is the same footgun that
  // let a throwaway chain shadow the deployment in the first place.
  const overrideDir = process.env.ARB_GUARDIAN_DEPLOYMENTS_DIR?.trim();
  const candidates = overrideDir
    ? [resolve(overrideDir, "latest.json")]
    : [
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

type LiveManifest = {
  networks?: Array<{
    name?: string;
    label?: string;
    chainId?: number;
    status?: string;
    contracts?: Array<{ contract?: string; address?: string }>;
  }>;
};

/**
 * The canonical record of what is deployed where.
 *
 * The web app hardcoded these addresses and the API did not know them at all, so the same
 * deployment had two answers depending on which side asked. This file is the one both read
 * from, and `npm run check:deployed` verifies it against the chain.
 */
function readLiveManifest(): {
  network: string;
  chainId: number | null;
  policyManager: string;
  executionGuard: string;
  status: DeploymentStatus["status"];
} | null {
  const candidates = [
    resolve(process.cwd(), "../../packages/contracts/evidence/live-deployments.json"),
    resolve(process.cwd(), "packages/contracts/evidence/live-deployments.json"),
    resolve(process.cwd(), "evidence/live-deployments.json")
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const manifest = JSON.parse(readFileSync(path, "utf8")) as LiveManifest;
      const networks = Array.isArray(manifest.networks) ? manifest.networks : [];
      const chosen = networks.find((n) => n.name === "arbitrumSepolia") ?? networks[0];
      if (!chosen) continue;
      const addressOf = (contract: string) =>
        chosen.contracts?.find((c) => c.contract === contract)?.address ?? null;
      const policyManager = addressOf("PolicyManager");
      const executionGuard = addressOf("ExecutionGuard");
      if (!policyManager || !executionGuard) continue;
      return {
        network: chosen.label ?? chosen.name ?? "unknown",
        chainId: chosen.chainId ?? null,
        policyManager,
        executionGuard,
        status: chosen.status === "current" ? "current" : chosen.status === "superseded" ? "superseded" : "unknown"
      };
    } catch {
      continue;
    }
  }
  return null;
}

export function getDeploymentStatus(): DeploymentStatus {
  const fromEnvPolicy = process.env.SUBMISSION_POLICY_MANAGER_ADDRESS?.trim() || null;
  const fromEnvGuard = process.env.SUBMISSION_EXECUTION_GUARD_ADDRESS?.trim() || null;
  if (fromEnvPolicy && fromEnvGuard) {
    const live = readLiveManifest();
    const status =
      live?.policyManager.toLowerCase() === fromEnvPolicy.toLowerCase() &&
      live.executionGuard.toLowerCase() === fromEnvGuard.toLowerCase()
        ? live.status
        : "unknown";
    return buildDeploymentStatus(
      process.env.SUBMISSION_NETWORK?.trim() || "Arbitrum Sepolia",
      Number(process.env.SUBMISSION_CHAIN_ID ?? "421614"),
      fromEnvPolicy,
      fromEnvGuard,
      process.env.SUBMISSION_POLICY_MANAGER_TX?.trim() || null,
      process.env.SUBMISSION_EXECUTION_GUARD_TX?.trim() || null,
      "env",
      status
    );
  }

  const local = readLocalLatest();
  // A local `deploy.ts` run leaves latest.json behind. It is a build artifact, and reading it as
  // the product's deployment let a throwaway Hardhat chain (id 31337) shadow the real one for the
  // whole API — the live client checks then skipped silently instead of failing. Only a real
  // network's record is allowed to win; anything else falls through to the committed manifest.
  const localIsRealNetwork =
    local !== null && local.chainId !== undefined && local.chainId !== null && local.chainId !== 31337;
  if (localIsRealNetwork && local?.policyManager?.address && local?.executionGuard?.address) {
    const isSepolia = local.network === "arbitrumSepolia" || local.chainId === 421614;
    return buildDeploymentStatus(
      isSepolia ? "Arbitrum Sepolia" : (local.network ?? "local"),
      local.chainId ?? null,
      local.policyManager.address,
      local.executionGuard.address,
      local.policyManager.txHash ?? null,
      local.executionGuard.txHash ?? null,
      "local-file",
      "unknown"
    );
  }

  const live = readLiveManifest();
  if (live) {
    return buildDeploymentStatus(
      live.network,
      live.chainId,
      live.policyManager,
      live.executionGuard,
      null,
      null,
      "live-manifest",
      live.status
    );
  }

  return {
    ready: false,
    status: "unknown",
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
