#!/usr/bin/env node
/**
 * P0 launch orchestration: deploy Sepolia (if .env key present), record evidence, finalize submission copy.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

function loadDotEnv(filePath) {
  try {
    const raw = readFileSync(filePath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      if (!line || line.trim().startsWith("#")) continue;
      const idx = line.indexOf("=");
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // ignore
  }
}

function run(cmd, args, cwd = process.cwd()) {
  const result = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: true, env: process.env });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${cmd} ${args.join(" ")}`);
  }
}

loadDotEnv(resolve(process.cwd(), ".env"));

const hasDeployerKey = Boolean(process.env.DEPLOYER_PRIVATE_KEY?.trim());

if (hasDeployerKey) {
  console.log("Deploying contracts to Arbitrum Sepolia…");
  run("npm", ["run", "deploy:sepolia:full", "-w", "packages/contracts"]);

  const deploymentPath = resolve(process.cwd(), "packages/contracts/deployments/arbitrumSepolia.json");
  if (!existsSync(deploymentPath)) {
    throw new Error(`Expected deployment file missing: ${deploymentPath}`);
  }
  const deployment = JSON.parse(readFileSync(deploymentPath, "utf8"));

  const envUpdates = {
    SUBMISSION_NETWORK: "Arbitrum Sepolia",
    SUBMISSION_CHAIN_ID: String(deployment.chainId ?? 421614),
    SUBMISSION_POLICY_MANAGER_ADDRESS: deployment.policyManager.address,
    SUBMISSION_EXECUTION_GUARD_ADDRESS: deployment.executionGuard.address,
    SUBMISSION_POLICY_MANAGER_TX: deployment.policyManager.txHash ?? "",
    SUBMISSION_EXECUTION_GUARD_TX: deployment.executionGuard.txHash ?? "",
    SUBMISSION_EXPLORER_BASE_URL: "https://sepolia.arbiscan.io/tx/",
    SUBMISSION_REPO_URL: "https://github.com/thesithunyein/arb-guardian",
    SUBMISSION_WEB_URL: process.env.SUBMISSION_WEB_URL ?? "https://arb-guardian.vercel.app"
  };

  const envPath = resolve(process.cwd(), ".env");
  let envContent = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  for (const [key, value] of Object.entries(envUpdates)) {
    process.env[key] = value;
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${key}=.*$`, "m");
    envContent = envContent.match(pattern) ? envContent.replace(pattern, line) : `${envContent.trim()}\n${line}\n`;
  }
  writeFileSync(envPath, envContent.trim() + "\n", "utf8");
  console.log("Updated .env with Sepolia deployment addresses.");
} else {
  console.warn("DEPLOYER_PRIVATE_KEY not set — skipping Sepolia deploy.");
  console.warn("Copy .env.example to .env, fund Arbitrum Sepolia ETH, then rerun: npm run deploy:p0");
}

if (
  process.env.SUBMISSION_POLICY_MANAGER_ADDRESS &&
  process.env.SUBMISSION_EXECUTION_GUARD_ADDRESS &&
  process.env.SUBMISSION_POLICY_MANAGER_TX &&
  process.env.SUBMISSION_EXECUTION_GUARD_TX
) {
  run("node", ["scripts/record-deployment-evidence.mjs"]);
}

run("node", ["scripts/finalize-submission.mjs"]);
console.log("P0 orchestration complete.");
