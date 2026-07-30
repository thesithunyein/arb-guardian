#!/usr/bin/env node
/**
 * Creates real local .env values and syncs public VITE_* vars to Vercel.
 * Does not print private keys.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { Wallet } from "ethers";

const root = process.cwd();
const rootEnvPath = resolve(root, ".env");
const webEnvPath = resolve(root, "apps/web/.env.production.local");
const webDevEnvPath = resolve(root, "apps/web/.env.local");

function strongKey(bytes = 24) {
  return randomBytes(bytes).toString("base64url");
}

function parseEnv(raw) {
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return out;
}

function serializeEnv(map) {
  return Object.entries(map)
    .map(([k, v]) => `${k}=${v ?? ""}`)
    .join("\n") + "\n";
}

function upsertEnv(filePath, updates) {
  const current = existsSync(filePath) ? parseEnv(readFileSync(filePath, "utf8")) : {};
  const next = { ...current, ...updates };
  writeFileSync(filePath, serializeEnv(next), "utf8");
  return next;
}

function vercelSet(key, value, target) {
  const result = spawnSync("vercel", ["env", "add", key, target, "--force"], {
    input: `${value ?? ""}\n`,
    encoding: "utf8",
    shell: true,
    cwd: root
  });
  if (result.status !== 0) {
    throw new Error(`Failed setting ${key} (${target}): ${result.stderr || result.stdout}`);
  }
}

const wallet = Wallet.createRandom();
const apiKey = strongKey(24);

const rootUpdates = {
  ARBITRUM_SEPOLIA_RPC_URL: "https://sepolia-rollup.arbitrum.io/rpc",
  DEPLOYER_PRIVATE_KEY: wallet.privateKey.replace(/^0x/, ""),
  OPERATOR_PRIVATE_KEY: wallet.privateKey.replace(/^0x/, ""),
  PORT: "8787",
  API_KEY: apiKey,
  SUBMISSION_CHAIN_ID: "421614",
  SUBMISSION_WEB_URL: "https://arb-guardian.vercel.app",
  SUBMISSION_API_URL: "",
  SUBMISSION_DEMO_URL: "",
  SUBMISSION_REPO_URL: "https://github.com/thesithunyein/arb-guardian",
  SUBMISSION_POLICY_MANAGER_ADDRESS: "",
  SUBMISSION_EXECUTION_GUARD_ADDRESS: "",
  SUBMISSION_POLICY_MANAGER_TX: "",
  SUBMISSION_EXECUTION_GUARD_TX: "",
  SUBMISSION_NETWORK: "Arbitrum Sepolia",
  SUBMISSION_EXPLORER_BASE_URL: "https://sepolia.arbiscan.io/tx/"
};

const webUpdates = {
  VITE_API_BASE_URL: "",
  VITE_API_KEY: apiKey,
  VITE_CHAIN_NAME: "Arbitrum Sepolia",
  VITE_POLICY_MANAGER_ADDRESS: "",
  VITE_EXECUTION_GUARD_ADDRESS: ""
};

upsertEnv(rootEnvPath, rootUpdates);
upsertEnv(webEnvPath, webUpdates);
upsertEnv(webDevEnvPath, {
  ...webUpdates,
  VITE_API_BASE_URL: "http://localhost:8787"
});

const targets = ["production", "preview", "development"];
for (const target of targets) {
  vercelSet("VITE_CHAIN_NAME", webUpdates.VITE_CHAIN_NAME, target);
  vercelSet("VITE_API_KEY", webUpdates.VITE_API_KEY, target);
  vercelSet("VITE_API_BASE_URL", webUpdates.VITE_API_BASE_URL, target);
  vercelSet("VITE_POLICY_MANAGER_ADDRESS", webUpdates.VITE_POLICY_MANAGER_ADDRESS, target);
  vercelSet("VITE_EXECUTION_GUARD_ADDRESS", webUpdates.VITE_EXECUTION_GUARD_ADDRESS, target);
}

writeFileSync(
  resolve(root, ".deployer-address.txt"),
  `${wallet.address}\n`,
  "utf8"
);

console.log("Created real env values:");
console.log(`- .env (gitignored)`);
console.log(`- apps/web/.env.local (gitignored)`);
console.log(`- apps/web/.env.production.local (gitignored)`);
console.log(`- Vercel VITE_* synced for production/preview/development`);
console.log(`- Deployer address: ${wallet.address}`);
console.log("Fund that address on Arbitrum Sepolia, then run: npm run deploy:p0");
