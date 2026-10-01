/**
 * Everything that has to be true before a deploy can succeed, checked before any gas is spent.
 *
 * A deploy that fails halfway is the worst outcome here: it costs gas, it leaves a deployment record
 * pointing at contracts that may not be verified, and it has to be unpicked by hand. So this runs
 * first and refuses to pass until every prerequisite holds.
 *
 *   npm run deploy:preflight
 *
 * Reads the private key only to derive its address. The key itself is never printed, logged or
 * written anywhere by this script.
 *
 * Exit codes: 0 every prerequisite holds, 1 one or more do not.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Wallet } from "ethers";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACTS = join(ROOT, "packages", "contracts");
const MANIFEST = join(CONTRACTS, "evidence", "live-deployments.json");

const FAUCETS = {
  arbitrumSepolia: [
    "https://arbitrum.faucet.dev/",
    "https://faucet.quicknode.com/arbitrum/sepolia",
    "https://www.l2faucet.com/arbitrum"
  ],
  robinhoodTestnet: ["https://faucet.testnet.chain.robinhood.com/"]
};

function loadDotEnv(path) {
  if (!existsSync(path)) return false;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
  return true;
}

function looksLikePlaceholder(value) {
  return /replace|your_|xxx|changeme|<|paste/i.test(value ?? "");
}

async function balance(url, address) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getBalance",
        params: [address, "latest"]
      }),
      signal: controller.signal
    });
    const body = await response.json();
    if (body.error) throw new Error(body.error.message ?? JSON.stringify(body.error));
    return BigInt(body.result ?? "0x0");
  } finally {
    clearTimeout(timer);
  }
}

function formatEther(wei) {
  const whole = wei / 10n ** 18n;
  const rest = (wei % 10n ** 18n).toString().padStart(18, "0").slice(0, 6);
  return `${whole}.${rest}`;
}

async function main() {
  const problems = [];
  const warnings = [];

  const envPath = join(ROOT, ".env");
  const loaded = loadDotEnv(envPath);
  if (!loaded) {
    problems.push(
      `No .env at ${envPath}. Copy .env.example to .env and fill in DEPLOYER_PRIVATE_KEY plus the two explorer API keys.`
    );
  }

  const required = {
    DEPLOYER_PRIVATE_KEY: "a funded testnet key — this address becomes the policy admin",
    ARBISCAN_API_KEY: "Arbiscan source verification",
    ROBINHOOD_EXPLORER_API_KEY: "Robinhood explorer source verification"
  };
  const missing = Object.entries(required)
    .filter(([key]) => !process.env[key]?.trim() || looksLikePlaceholder(process.env[key]))
    .map(([key, why]) => `${key} — needed for ${why}`);
  for (const item of missing) problems.push(item);

  const key = process.env.DEPLOYER_PRIVATE_KEY?.trim();
  let address = null;
  if (key && !looksLikePlaceholder(key)) {
    try {
      const normalized = key.startsWith("0x") ? key : `0x${key}`;
      address = new Wallet(normalized).address;
    } catch {
      problems.push("DEPLOYER_PRIVATE_KEY is set but is not a valid secp256k1 private key.");
    }
  }

  if (existsSync(MANIFEST)) {
    const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
    const networks = manifest.networks ?? [];
    const rpcs = networks.map((network) => ({
      name: network.name,
      label: network.label,
      chainId: network.chainId,
      rpc: network.rpc
    }));

    if (address) {
      console.log(`Deployer address: ${address}`);
      console.log("(This address will hold every policy role after the deploy.)\n");
      for (const network of rpcs) {
        process.stdout.write(`  ${network.label.padEnd(28)} `);
        try {
          const wei = await balance(network.rpc, address);
          const enough = wei > 10n ** 14n; // 0.001 ETH: plenty for three contracts and a Safe
          console.log(`${formatEther(wei)} ETH ${enough ? "— funded" : "— NOT ENOUGH for a deploy"}`);
          if (!enough) {
            problems.push(
              `${network.label}: ${formatEther(wei)} ETH at ${address}. Claim from: ${(
                FAUCETS[network.name] ?? ["no faucet listed"]
              ).join("  or  ")}`
            );
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.log(`RPC unreachable (${message})`);
          warnings.push(`${network.label} RPC could not be reached, so its balance is unverified.`);
        }
      }
    }

    const current = networks.filter((network) => network.status === "current");
    for (const network of current) {
      warnings.push(
        `${network.label} is already declared "current" — deploying again replaces those addresses.`
      );
    }
  }

  if (!existsSync(join(CONTRACTS, "artifacts", "contracts", "PolicyManager.sol"))) {
    warnings.push(
      "No compiled artifacts yet — the first deploy will compile, so this just costs a minute."
    );
  }

  console.log("\n---");

  if (warnings.length > 0) {
    for (const warning of warnings) console.warn(`note: ${warning}`);
    console.log("");
  }

  if (problems.length > 0) {
    for (const problem of problems) console.error(`BLOCKED: ${problem}`);
    console.error(`\n${problems.length} prerequisite(s) missing. Nothing has been deployed.`);
    process.exitCode = 1;
    return;
  }

  console.log("Every prerequisite holds. Next:");
  console.log("  1. npm run redeploy:sepolia     (deploy + seed + enroll, then verify)");
  console.log("  2. npm run redeploy:robinhood   (same, on the second lane)");
  console.log("  3. npm run repoint              (repoint the manifest and the app, then prove it)");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
