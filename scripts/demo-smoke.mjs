import { readFileSync } from "node:fs";
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
    // ignore
  }
}

loadDotEnv(resolve(process.cwd(), ".env"));

const baseUrl = process.env.SUBMISSION_API_URL || "http://localhost:8787";
const apiKey = process.env.API_KEY;

function headers() {
  const base = { "Content-Type": "application/json" };
  if (apiKey) return { ...base, "x-api-key": apiKey };
  return base;
}

async function check(path, init) {
  const res = await fetch(`${baseUrl}${path}`, init);
  return { path, ok: res.ok, status: res.status };
}

async function main() {
  const checks = [];
  checks.push(await check("/health"));
  checks.push(await check("/status"));
  checks.push(await check("/incidents"));
  checks.push(await check("/kpi"));
  checks.push(
    await check("/risk/assess", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        txHash: "0xdemo-smoke",
        wallet: "0xWalletSmoke",
        destination: "0xSmokeDestination",
        method: "approve",
        amountWei: "1000",
        allowlisted: false,
        dailyLimitWei: "500",
        spentTodayWei: "0"
      })
    })
  );

  const failed = checks.filter((c) => !c.ok);
  for (const c of checks) {
    console.log(`${c.path} -> ${c.status}`);
  }

  if (failed.length > 0) {
    throw new Error(`Smoke checks failed: ${failed.map((f) => f.path).join(", ")}`);
  }
  console.log("Demo smoke checks passed.");
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
