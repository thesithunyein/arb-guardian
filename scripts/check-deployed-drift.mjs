/**
 * Does the bytecode on the chain still match the source in this repository?
 *
 * Three of the four things a reviewer checks are already reproducible from source
 * (contract tests, the guard proof, the policy digest chain). The fourth was a claim in
 * prose: that the addresses in docs/live-deployment.md run an earlier build. This turns
 * that claim into a check.
 *
 * Solidity appends a CBOR blob to runtime bytecode containing the IPFS hash of the
 * metadata JSON — the same fingerprint an explorer compares during verification. Two
 * builds from different sources produce different hashes, and the hash is unaffected by
 * constructor-set `immutable` values, so it survives a redeploy to a new chain id.
 *
 * Each network in evidence/live-deployments.json declares what it is supposed to be:
 *   "current"    — the deployed bytecode MUST match this repository, or the claim fails.
 *   "superseded" — the deployed bytecode MUST NOT match, and the size delta is reported.
 *
 * The verdict is written to evidence/deployed-drift.json, which the web app renders, so the
 * status shown on the site is generated rather than asserted. Both files live under evidence/
 * because both are committed and imported at build time.
 *
 * Reads no keys and writes nothing on-chain: any public RPC will do.
 *
 * Exit codes: 0 claim held (or the RPC was unreachable — reported, not passed silently),
 *             1 a claim was violated.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACTS = join(ROOT, "packages", "contracts");
const MANIFEST = join(CONTRACTS, "evidence", "live-deployments.json");
const REPORT = join(CONTRACTS, "evidence", "deployed-drift.json");
const ARTIFACTS = join(CONTRACTS, "artifacts", "contracts");

/** Pull the metadata fingerprint out of runtime bytecode. */
function fingerprint(code) {
  const hex = (code.startsWith("0x") ? code.slice(2) : code).toLowerCase();
  const bytes = hex.length / 2;
  if (bytes === 0) return { bytes: 0, metadata: null, solc: null };
  if (hex.length < 8) return { bytes, metadata: null, solc: null };

  const cborLength = Number.parseInt(hex.slice(-4), 16);
  if (!Number.isFinite(cborLength) || cborLength === 0 || cborLength > 200) {
    return { bytes, metadata: null, solc: null };
  }
  const cbor = hex.slice(-4 - cborLength * 2, -4);

  const ipfs = cbor.indexOf("69706673"); // "ipfs"
  const metadata = ipfs >= 0 ? `0x${cbor.slice(ipfs + 8 + 8, ipfs + 8 + 8 + 64)}` : null;
  const solcMarker = cbor.indexOf("736f6c63"); // "solc"
  const solc =
    solcMarker >= 0
      ? `0.${Number.parseInt(cbor.slice(solcMarker + 10, solcMarker + 12), 16)}.${Number.parseInt(cbor.slice(solcMarker + 12, solcMarker + 14), 16)}`
      : null;
  return { bytes, metadata, solc };
}

/** Index compiled artifacts by contract name. */
function loadArtifacts() {
  const found = new Map();
  if (!existsSync(ARTIFACTS)) return found;
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.endsWith(".json") || entry.endsWith(".dbg.json")) continue;
      try {
        const artifact = JSON.parse(readFileSync(full, "utf8"));
        if (artifact.deployedBytecode && artifact.contractName) {
          found.set(artifact.contractName, artifact);
        }
      } catch {
        // not an artifact
      }
    }
  };
  walk(ARTIFACTS);
  return found;
}

async function getCode(rpc, address) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getCode",
        params: [address, "latest"]
      }),
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    if (body.error) throw new Error(body.error.message ?? "rpc error");
    if (typeof body.result !== "string") throw new Error("no result");
    return body.result;
  } finally {
    clearTimeout(timer);
  }
}

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const artifacts = loadArtifacts();
const compiled = artifacts.size > 0;

if (!compiled) {
  console.log("No compiled artifacts found. Run `npm run build -w packages/contracts` first.");
}

const report = {
  kind: "arb-guardian-deployed-drift",
  generatedAt: new Date().toISOString(),
  method:
    "Solidity metadata fingerprint (IPFS hash from the trailing CBOR blob) and runtime bytecode size, read over each network's public RPC.",
  note: "Compares this repository's build against the bytecode live at the recorded addresses. It does not re-audit the deployed contract.",
  compiled,
  networks: [],
  summary: {
    networks: 0,
    checked: 0,
    matched: 0,
    drifted: 0,
    absent: 0,
    unreachable: 0,
    claimsHeld: 0,
    claimsViolated: 0
  }
};

let violated = 0;

for (const network of manifest.networks) {
  const row = {
    name: network.name,
    label: network.label,
    chainId: network.chainId,
    explorer: network.explorer,
    declared: network.status,
    reachable: false,
    contracts: []
  };

  for (const entry of network.contracts) {
    const artifact = artifacts.get(entry.contract);
    const local = artifact ? fingerprint(artifact.deployedBytecode) : null;
    const record = {
      contract: entry.contract,
      address: entry.address,
      url: `${network.explorer}/address/${entry.address}`,
      onchainBytes: null,
      localBytes: local ? local.bytes : null,
      onchainMetadata: null,
      localMetadata: local ? local.metadata : null,
      solc: null,
      verdict: "unknown"
    };

    if (!compiled) {
      record.verdict = "not-compared";
      row.contracts.push(record);
      continue;
    }

    try {
      const code = await getCode(network.rpc, entry.address);
      row.reachable = true;
      const onchain = fingerprint(code);
      record.onchainBytes = onchain.bytes;
      record.onchainMetadata = onchain.metadata;
      record.solc = onchain.solc;

      if (onchain.bytes === 0) record.verdict = "absent";
      else if (onchain.metadata && local && onchain.metadata === local.metadata)
        record.verdict = "match";
      else record.verdict = "drift";
    } catch (err) {
      record.verdict = "unreachable";
      record.error = err instanceof Error ? err.message : String(err);
      report.summary.unreachable += 1;
    }

    const expectedCurrent = network.status === "current";
    const held =
      record.verdict === "unreachable"
        ? null
        : expectedCurrent
          ? record.verdict === "match"
          : record.verdict === "drift";

    record.claim = expectedCurrent ? "deployed must match source" : "deployed must differ from source";
    record.claimHeld = held;
    if (held === true) report.summary.claimsHeld += 1;
    if (held === false) {
      report.summary.claimsViolated += 1;
      violated += 1;
    }

    if (record.verdict === "match") report.summary.matched += 1;
    else if (record.verdict === "drift") report.summary.drifted += 1;
    else if (record.verdict === "absent") report.summary.absent += 1;
    report.summary.checked += 1;

    row.contracts.push(record);
  }

  report.networks.push(row);
  report.summary.networks += 1;
}

mkdirSync(dirname(REPORT), { recursive: true });
writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);

if (!compiled) {
  console.log("Drift check skipped: nothing to compare against.");
  process.exit(0);
}

for (const network of report.networks) {
  console.log(`\n${network.label} — declared ${network.declared}`);
  if (!network.reachable) {
    console.log("  unreachable: could not read the RPC; claim not evaluated");
    continue;
  }
  for (const c of network.contracts) {
    const size =
      c.onchainBytes === null
        ? "no code"
        : `${c.onchainBytes.toLocaleString()} on-chain vs ${c.localBytes.toLocaleString()} here`;
    const mark = c.claimHeld === true ? "ok" : c.claimHeld === false ? "FAILED" : "skipped";
    console.log(`  [${mark}] ${c.contract}: ${c.verdict} — ${size}`);
    if (c.verdict === "drift") {
      console.log(`         on-chain metadata ${c.onchainMetadata}`);
      console.log(`         this build       ${c.localMetadata}`);
    }
  }
}

const { checked, claimsHeld, claimsViolated, unreachable } = report.summary;
console.log(
  `\n${checked} contract(s) compared · ${claimsHeld} claim(s) held · ${claimsViolated} violated` +
    (unreachable ? ` · ${unreachable} unreachable` : "")
);
console.log(`Wrote ${REPORT.replace(`${ROOT}\\`, "").replace(`${ROOT}/`, "")}`);

if (violated > 0) {
  console.error(
    "\nA declared deployment status no longer matches the chain. Redeploy and update " +
      "packages/contracts/evidence/live-deployments.json, or fix the claim."
  );
  process.exit(1);
}
