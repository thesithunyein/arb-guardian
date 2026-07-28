import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

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
    // ignore missing .env
  }
}

loadDotEnv(resolve(process.cwd(), ".env"));

const required = [
  "SUBMISSION_POLICY_MANAGER_ADDRESS",
  "SUBMISSION_EXECUTION_GUARD_ADDRESS",
  "SUBMISSION_POLICY_MANAGER_TX",
  "SUBMISSION_EXECUTION_GUARD_TX"
];

const missing = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`Missing deployment fields in .env:\n${missing.join("\n")}`);
  process.exit(1);
}

const network = process.env.SUBMISSION_NETWORK ?? "Arbitrum Sepolia";
const explorerBase = process.env.SUBMISSION_EXPLORER_BASE_URL ?? "https://sepolia.arbiscan.io/tx/";

const evidence = {
  generatedAt: new Date().toISOString(),
  network,
  policyManager: {
    address: process.env.SUBMISSION_POLICY_MANAGER_ADDRESS,
    txHash: process.env.SUBMISSION_POLICY_MANAGER_TX,
    txUrl: `${explorerBase}${process.env.SUBMISSION_POLICY_MANAGER_TX}`
  },
  executionGuard: {
    address: process.env.SUBMISSION_EXECUTION_GUARD_ADDRESS,
    txHash: process.env.SUBMISSION_EXECUTION_GUARD_TX,
    txUrl: `${explorerBase}${process.env.SUBMISSION_EXECUTION_GUARD_TX}`
  }
};

const md = `# Deployment Evidence

- Network: ${evidence.network}
- Generated at: ${evidence.generatedAt}

## PolicyManager
- Address: \`${evidence.policyManager.address}\`
- Tx hash: \`${evidence.policyManager.txHash}\`
- Tx link: ${evidence.policyManager.txUrl}

## ExecutionGuard
- Address: \`${evidence.executionGuard.address}\`
- Tx hash: \`${evidence.executionGuard.txHash}\`
- Tx link: ${evidence.executionGuard.txUrl}
`;

writeFileSync(resolve(process.cwd(), "docs", "deployment-evidence.json"), JSON.stringify(evidence, null, 2), "utf8");
writeFileSync(resolve(process.cwd(), "docs", "deployment-evidence.md"), md, "utf8");
console.log("Generated docs/deployment-evidence.{json,md}");
