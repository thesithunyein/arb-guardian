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

const scenarios = [
  {
    txHash: "0xdemo-seed-1",
    wallet: "0x1111111111111111111111111111111111111111",
    destination: "0x5555555555555555555555555555555555555555",
    method: "approve",
    amountWei: "1000000000000000000"
  },
  {
    txHash: "0xdemo-seed-2",
    wallet: "0x2222222222222222222222222222222222222222",
    destination: "0x4444444444444444444444444444444444444444",
    method: "transfer",
    amountWei: "4000000000000000000"
  },
  {
    txHash: "0xdemo-seed-3",
    wallet: "0x3333333333333333333333333333333333333333",
    destination: "0x4444444444444444444444444444444444444444",
    method: "transfer",
    amountWei: "1000000000000000000"
  }
];

async function main() {
  let firstIncidentId = null;

  for (const payload of scenarios) {
    const res = await fetch(`${baseUrl}/risk/assess`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      throw new Error(`Scenario failed ${payload.txHash}: ${res.status}`);
    }
    const data = await res.json();
    if (!firstIncidentId && data.incident?.id) {
      firstIncidentId = data.incident.id;
    }
  }

  if (firstIncidentId) {
    await fetch(`${baseUrl}/incidents/${firstIncidentId}/action`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ action: "mitigate", actor: "demo-seed-script" })
    });
  }

  console.log("Demo seed completed.");
  console.log(`API: ${baseUrl}`);
  if (firstIncidentId) {
    console.log(`Mitigated incident: ${firstIncidentId}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
