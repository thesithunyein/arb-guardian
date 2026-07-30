/**
 * Poll Robinhood testnet balance, then deploy+seed+enroll when funded.
 * Faucet: https://faucet.testnet.chain.robinhood.com/ (Google + Cloudflare required)
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { JsonRpcProvider } from "ethers";

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

function upsertEnv(updates) {
  const envPath = resolve(process.cwd(), ".env");
  let envContent = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  for (const [key, value] of Object.entries(updates)) {
    process.env[key] = value;
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${key}=.*$`, "m");
    envContent = envContent.match(pattern) ? envContent.replace(pattern, line) : `${envContent.trim()}\n${line}\n`;
  }
  writeFileSync(envPath, envContent.trim() + "\n", "utf8");
}

function run(cmd, args) {
  const result = spawnSync(cmd, args, { cwd: process.cwd(), stdio: "inherit", shell: true, env: process.env });
  if (result.status !== 0) throw new Error(`failed: ${cmd} ${args.join(" ")}`);
}

loadDotEnv(resolve(process.cwd(), ".env"));

const addressFile = resolve(process.cwd(), ".deployer-address.txt");
const deployer = existsSync(addressFile)
  ? readFileSync(addressFile, "utf8").trim()
  : "0x61a79efe7Acc6fBD23E24B0d7deCFAcb169404Ce";
const rpc = process.env.ROBINHOOD_TESTNET_RPC_URL || "https://rpc.testnet.chain.robinhood.com";
const provider = new JsonRpcProvider(rpc, 46630, { staticNetwork: true });

const maxAttempts = Number(process.env.RH_FUND_WAIT_ATTEMPTS || 60);
const delayMs = Number(process.env.RH_FUND_WAIT_MS || 15000);

console.log(`Waiting for Robinhood testnet ETH on ${deployer}`);
console.log(`Faucet: https://faucet.testnet.chain.robinhood.com/`);
console.log(`Send 0.01 ETH to ${deployer}, then this script continues automatically.`);

let funded = false;
for (let i = 1; i <= maxAttempts; i++) {
  try {
    const bal = await provider.getBalance(deployer);
    const eth = Number(bal) / 1e18;
    console.log(`[${i}/${maxAttempts}] balance=${eth} ETH`);
    if (eth >= 0.005) {
      funded = true;
      break;
    }
  } catch (err) {
    const msg = err?.shortMessage || err?.message || String(err);
    console.warn(`[${i}/${maxAttempts}] RPC error: ${msg}`);
  }
  await new Promise((r) => setTimeout(r, delayMs));
}

if (!funded) {
  console.error("Timed out waiting for faucet funds. Claim once with Google, then rerun:");
  console.error("  node scripts/deploy-robinhood-when-funded.mjs");
  process.exit(1);
}

console.log("Funds detected. Deploying Arb Guardian to Robinhood testnet…");
run("npm", ["run", "deploy:robinhood:full", "-w", "packages/contracts"]);

const deploymentPath = resolve(process.cwd(), "packages/contracts/deployments/robinhoodTestnet.json");
if (!existsSync(deploymentPath)) {
  throw new Error(`Missing ${deploymentPath}`);
}
const deployment = JSON.parse(readFileSync(deploymentPath, "utf8"));

const updates = {
  ROBINHOOD_TESTNET_RPC_URL: rpc,
  SUBMISSION_RH_CHAIN_ID: "46630",
  SUBMISSION_RH_POLICY_MANAGER_ADDRESS: deployment.policyManager.address,
  SUBMISSION_RH_EXECUTION_GUARD_ADDRESS: deployment.executionGuard.address,
  SUBMISSION_RH_SAFE_TREASURY_GUARD_ADDRESS: deployment.safeTreasuryGuard?.address ?? "",
  SUBMISSION_RH_TREASURY_SAFE_ADDRESS: deployment.treasurySafeShell?.address ?? "",
  SUBMISSION_RH_POLICY_MANAGER_TX: deployment.policyManager.txHash ?? "",
  SUBMISSION_RH_EXECUTION_GUARD_TX: deployment.executionGuard.txHash ?? "",
  SUBMISSION_RH_SAFE_TREASURY_GUARD_TX: deployment.safeTreasuryGuard?.txHash ?? "",
  SUBMISSION_RH_TREASURY_SAFE_TX: deployment.treasurySafeShell?.deployTxHash ?? "",
  VITE_RH_POLICY_MANAGER_ADDRESS: deployment.policyManager.address,
  VITE_RH_EXECUTION_GUARD_ADDRESS: deployment.executionGuard.address,
  VITE_RH_SAFE_TREASURY_GUARD_ADDRESS: deployment.safeTreasuryGuard?.address ?? "",
  VITE_RH_TREASURY_SAFE_ADDRESS: deployment.treasurySafeShell?.address ?? "",
  VITE_RH_POLICY_MANAGER_TX: deployment.policyManager.txHash ?? "",
  VITE_RH_EXECUTION_GUARD_TX: deployment.executionGuard.txHash ?? "",
  VITE_RH_SAFE_TREASURY_GUARD_TX: deployment.safeTreasuryGuard?.txHash ?? "",
  VITE_RH_TREASURY_SAFE_TX: deployment.treasurySafeShell?.deployTxHash ?? ""
};

upsertEnv(updates);

const explorer = "https://explorer.testnet.chain.robinhood.com";
const pm = deployment.policyManager.address;
const eg = deployment.executionGuard.address;
const stg = deployment.safeTreasuryGuard?.address ?? "";
const safe = deployment.treasurySafeShell?.address ?? "";

function patchFile(filePath, replacements) {
  if (!existsSync(filePath)) return;
  let text = readFileSync(filePath, "utf8");
  for (const [from, to] of replacements) {
    text = text.replace(from, to);
  }
  writeFileSync(filePath, text, "utf8");
}

const rhTable = `## Robinhood Chain Testnet (Overall reserved-lane)

| Field | Value |
| --- | --- |
| Network | Robinhood Chain Testnet |
| Chain ID | 46630 |
| RPC | \`https://rpc.testnet.chain.robinhood.com\` |
| Explorer | ${explorer} |
| PolicyManager | [\`${pm}\`](${explorer}/address/${pm}) |
| ExecutionGuard | [\`${eg}\`](${explorer}/address/${eg}) |
| SafeTreasuryGuard | [\`${stg}\`](${explorer}/address/${stg}) |
| Treasury Safe (enrolled) | [\`${safe}\`](${explorer}/address/${safe}) |
| Status | Deployed ${deployment.deployedAt ?? new Date().toISOString()} |
`;

const livePath = resolve(process.cwd(), "docs/live-deployment.md");
if (existsSync(livePath)) {
  const live = readFileSync(livePath, "utf8");
  const patched = live.replace(/## Robinhood Chain Testnet[\s\S]*?(?=\n## |\n*$)/, rhTable.trim() + "\n\n");
  writeFileSync(livePath, patched, "utf8");
}

const readmeRh = `## Robinhood Chain Testnet

| Field | Value |
| --- | --- |
| Chain ID | 46630 |
| RPC | \`https://rpc.testnet.chain.robinhood.com\` |
| Explorer | ${explorer} |
| PolicyManager | [\`${pm}\`](${explorer}/address/${pm}) |
| ExecutionGuard | [\`${eg}\`](${explorer}/address/${eg}) |
| SafeTreasuryGuard | [\`${stg}\`](${explorer}/address/${stg}) |
| Treasury Safe | [\`${safe}\`](${explorer}/address/${safe}) |
| Deploy | \`npm run deploy:robinhood:wait\` |
`;

const readmePath = resolve(process.cwd(), "README.md");
if (existsSync(readmePath)) {
  const readme = readFileSync(readmePath, "utf8");
  const patched = readme.replace(/## Robinhood Chain Testnet[\s\S]*?(?=\n## )/, readmeRh.trim() + "\n\n");
  writeFileSync(readmePath, patched, "utf8");
}

const subPath = resolve(process.cwd(), "docs/sep13-submission-copy.md");
if (existsSync(subPath)) {
  const sub = readFileSync(subPath, "utf8");
  const rhBlock = `## Robinhood Chain Testnet
- PolicyManager: \`${pm}\`
- ExecutionGuard: \`${eg}\`
- SafeTreasuryGuard: \`${stg}\`
- Treasury Safe: \`${safe}\`
`;
  writeFileSync(subPath, sub.replace(/## Robinhood Chain Testnet[\s\S]*?(?=\n## )/, rhBlock + "\n"), "utf8");
}

const configPath = resolve(process.cwd(), "apps/web/src/config.ts");
if (existsSync(configPath)) {
  let cfg = readFileSync(configPath, "utf8");
  cfg = cfg
    .replace(
      /export const RH_POLICY_MANAGER = import\.meta\.env\.VITE_RH_POLICY_MANAGER_ADDRESS\?\.trim\(\) \|\| "[^"]*";/,
      `export const RH_POLICY_MANAGER = import.meta.env.VITE_RH_POLICY_MANAGER_ADDRESS?.trim() || "${pm}";`
    )
    .replace(
      /export const RH_POLICY_MANAGER = import\.meta\.env\.VITE_RH_POLICY_MANAGER_ADDRESS\?\.trim\(\) \|\| "";/,
      `export const RH_POLICY_MANAGER = import.meta.env.VITE_RH_POLICY_MANAGER_ADDRESS?.trim() || "${pm}";`
    )
    .replace(
      /export const RH_EXECUTION_GUARD = import\.meta\.env\.VITE_RH_EXECUTION_GUARD_ADDRESS\?\.trim\(\) \|\| "[^"]*";/,
      `export const RH_EXECUTION_GUARD = import.meta.env.VITE_RH_EXECUTION_GUARD_ADDRESS?.trim() || "${eg}";`
    )
    .replace(
      /export const RH_EXECUTION_GUARD = import\.meta\.env\.VITE_RH_EXECUTION_GUARD_ADDRESS\?\.trim\(\) \|\| "";/,
      `export const RH_EXECUTION_GUARD = import.meta.env.VITE_RH_EXECUTION_GUARD_ADDRESS?.trim() || "${eg}";`
    )
    .replace(
      /export const RH_SAFE_TREASURY_GUARD = import\.meta\.env\.VITE_RH_SAFE_TREASURY_GUARD_ADDRESS\?\.trim\(\) \|\| "[^"]*";/,
      `export const RH_SAFE_TREASURY_GUARD = import.meta.env.VITE_RH_SAFE_TREASURY_GUARD_ADDRESS?.trim() || "${stg}";`
    )
    .replace(
      /export const RH_SAFE_TREASURY_GUARD = import\.meta\.env\.VITE_RH_SAFE_TREASURY_GUARD_ADDRESS\?\.trim\(\) \|\| "";/,
      `export const RH_SAFE_TREASURY_GUARD = import.meta.env.VITE_RH_SAFE_TREASURY_GUARD_ADDRESS?.trim() || "${stg}";`
    )
    .replace(
      /export const RH_TREASURY_SAFE = import\.meta\.env\.VITE_RH_TREASURY_SAFE_ADDRESS\?\.trim\(\) \|\| "[^"]*";/,
      `export const RH_TREASURY_SAFE = import.meta.env.VITE_RH_TREASURY_SAFE_ADDRESS?.trim() || "${safe}";`
    )
    .replace(
      /export const RH_TREASURY_SAFE = import\.meta\.env\.VITE_RH_TREASURY_SAFE_ADDRESS\?\.trim\(\) \|\| "";/,
      `export const RH_TREASURY_SAFE = import.meta.env.VITE_RH_TREASURY_SAFE_ADDRESS?.trim() || "${safe}";`
    );
  writeFileSync(configPath, cfg, "utf8");
}

console.log("Robinhood deployment complete. Updated .env, docs, README, and web config defaults.");
console.log(JSON.stringify(deployment, null, 2));
