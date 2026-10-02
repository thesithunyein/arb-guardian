/**
 * Publish the deployed sources to Sourcify and record what the verifier answered.
 *
 * `npm run check:deployed` proves the chain bytecode matches this repository — but only for
 * someone willing to run it. An explorer's source panel is the version a judge reads in one
 * click, and Arbiscan needs an API key. Sourcify is the keyless path: it takes the compiler's
 * own standard JSON input, recompiles it, compares both the creation and runtime bytecode, and
 * stores the result in a public repository anyone can open.
 *
 * The input comes from the build-info that produced the deployed artifact, not from the working
 * tree. That distinction matters here more than anywhere else: the metadata hash that Sourcify
 * compares is taken over the exact source bytes that were compiled, so handing it a freshly
 * read tree would fail on nothing more than a line-ending change.
 *
 * Usage:
 *   node scripts/verify-sourcify.mjs --network arbitrumSepolia
 *   node scripts/verify-sourcify.mjs --network all
 *
 * Writes evidence/sourcify.json, which is the record the submission copy quotes. Exit code 1 if
 * any contract did not reach a match, so a partial result cannot be mistaken for a full one.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { standardJsonInput } from "./lib/build-info.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACTS = join(ROOT, "packages", "contracts");
const EVIDENCE = join(CONTRACTS, "evidence", "sourcify.json");
const API = "https://sourcify.dev/server";
const REPO = "https://repo.sourcify.dev/contracts";

/** Lanes we verify, in the order the evidence file lists them. */
const LANES = {
  arbitrumSepolia: {
    deployment: "arbitrumSepolia.json",
    explorerApi: "https://arbitrum-sepolia.blockscout.com",
    contracts: [
      { artifact: "contracts/PolicyManager.sol/PolicyManager.json", source: "contracts/PolicyManager.sol:PolicyManager", txKey: "policyManager" },
      { artifact: "contracts/ExecutionGuard.sol/ExecutionGuard.json", source: "contracts/ExecutionGuard.sol:ExecutionGuard", txKey: "executionGuard" },
      { artifact: "contracts/SafeTreasuryGuard.sol/SafeTreasuryGuard.json", source: "contracts/SafeTreasuryGuard.sol:SafeTreasuryGuard", txKey: "safeTreasuryGuard" }
    ]
  },
  robinhoodTestnet: {
    deployment: "robinhoodTestnet.json",
    explorerApi: "https://explorer.testnet.chain.robinhood.com",
    contracts: [
      { artifact: "contracts/PolicyManager.sol/PolicyManager.json", source: "contracts/PolicyManager.sol:PolicyManager", txKey: "policyManager" },
      { artifact: "contracts/ExecutionGuard.sol/ExecutionGuard.json", source: "contracts/ExecutionGuard.sol:ExecutionGuard", txKey: "executionGuard" },
      { artifact: "contracts/SafeTreasuryGuard.sol/SafeTreasuryGuard.json", source: "contracts/SafeTreasuryGuard.sol:SafeTreasuryGuard", txKey: "safeTreasuryGuard" }
    ]
  }
};

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const verbose = process.argv.includes("--verbose");
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function post(path, body) {
  const response = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // left null; the caller reports the raw body
  }
  return { status: response.status, parsed, text };
}

async function get(path) {
  const response = await fetch(`${API}${path}`);
  const text = await response.text();
  try {
    return { status: response.status, parsed: JSON.parse(text), text };
  } catch {
    return { status: response.status, parsed: null, text };
  }
}

/** Absolute-URL read, for the explorers, which are not behind the Sourcify base path. */
async function getAbsolute(url) {
  const response = await fetch(url);
  const text = await response.text();
  try {
    return { status: response.status, parsed: JSON.parse(text), text };
  } catch {
    return { status: response.status, parsed: null, text };
  }
}

/** Sourcify nests a finished result under `contract`; a bare lookup puts the fields at the top. */
function contractOf(result) {
  if (!result || typeof result !== "object") return null;
  if (result.contract && typeof result.contract === "object") return result.contract;
  if (result.match) return result;
  return null;
}

/**
 * Sourcify accepts the job, then finishes it asynchronously. The POST sometimes answers with the
 * completed result (already verified), sometimes with a job id, so both shapes are handled.
 */
async function verifyOne(chainId, { address, txHash, stdJsonInput, compilerVersion, contractIdentifier }) {
  const submitted = await post(`/v2/verify/${chainId}/${address}`, {
    stdJsonInput,
    compilerVersion,
    contractIdentifier,
    creationTransactionHash: txHash
  });
  if (verbose) console.log(`    submit ${submitted.status}: ${submitted.text.slice(0, 300)}`);

  const first = submitted.parsed;
  if (!first) return { ok: false, detail: `HTTP ${submitted.status}: ${submitted.text.slice(0, 200)}` };

  let result = first;
  const jobId = first.verificationId ?? first.jobId;
  // A completed job answers with the contract under `contract`; a direct answer puts it at the top.
  if (!contractOf(first) && jobId) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await sleep(3000);
      const polled = await get(`/v2/verify/${jobId}`);
      if (verbose) console.log(`    poll ${attempt + 1} ${polled.status}: ${polled.text.slice(0, 200)}`);
      if (contractOf(polled.parsed) || polled.parsed?.error || polled.parsed?.isJobCompleted) {
        result = polled.parsed;
        break;
      }
    }
  }

  let contract = contractOf(result);

  // Re-submitting an already published contract is answered with an error rather than a match, and
  // a first-time publish can also complete a moment after the job reports done. One read of the
  // record settles both cases instead of guessing from the submission response.
  if (!contract) {
    const existing = await get(`/v2/contract/${chainId}/${address}`);
    if (verbose) console.log(`    record ${existing.status}: ${existing.text.slice(0, 200)}`);
    contract = contractOf(existing.parsed);
  }

  const match = contract?.match ?? null;
  const link = match
    ? `${REPO}/${match}/${chainId}/${address}/`
    : `https://sourcify.dev/#/lookup/${address}`;

  // Sourcify forwards a successful match to the explorers that read it. Those panels are what a
  // judge actually clicks, so the forwarded status is part of the record rather than a footnote.
  const forwarded = result?.externalVerifications ?? {};
  return {
    ok: Boolean(match),
    match,
    creationMatch: contract?.creationMatch ?? null,
    runtimeMatch: contract?.runtimeMatch ?? null,
    verifiedAt: contract?.verifiedAt ?? null,
    link,
    forwarded: {
      blockscout: forwarded.blockscout?.explorerUrl
        ? { explorer: forwarded.blockscout.explorerUrl, status: forwarded.blockscout.statusUrl }
        : null,
      etherscanError: forwarded.etherscan?.error ?? null
    },
    detail: result?.error ?? result?.message ?? null
  };
}

async function verifyLane(laneName, lane) {
  const recordPath = join(CONTRACTS, "deployments", lane.deployment);
  if (!existsSync(recordPath)) {
    return { lane: laneName, skipped: `no deployment record at ${recordPath}`, contracts: [] };
  }
  const record = JSON.parse(readFileSync(recordPath, "utf8"));
  console.log(`\n${record.network} (chain ${record.chainId})`);

  // Sourcify is the repository; the explorer is the page a judge opens. Record both, because
  // "published" and "visible" are different claims and only one of them is checkable in a click.
  const explorerApi = lane.explorerApi ?? null;

  const contracts = [];
  for (const entry of lane.contracts) {
    const contractName = entry.source.split(":")[1];
    const { address, txHash } = record[entry.txKey] ?? {};
    if (!address) {
      contracts.push({ contract: contractName, ok: false, detail: "not in the deployment record" });
      continue;
    }
    console.log(`  ${contractName} @ ${address}`);
    const { stdJsonInput, compilerVersion } = standardJsonInput(CONTRACTS, entry.artifact);
    const outcome = await verifyOne(record.chainId, {
      address,
      txHash,
      stdJsonInput,
      compilerVersion,
      contractIdentifier: entry.source
    });
    console.log(
      outcome.ok
        ? `    match: ${outcome.match}\n    ${outcome.link}`
        : `    NOT VERIFIED — ${outcome.detail ?? "no match reported"}`
    );

    let explorerPanel = null;
    if (explorerApi) {
      const panel = await getAbsolute(`${explorerApi}/api/v2/smart-contracts/${address}`);
      const data = panel.parsed;
      if (data && typeof data === "object" && "is_verified" in data) {
        explorerPanel = {
          explorer: `${explorerApi}/address/${address}`,
          verified: Boolean(data.is_verified),
          fullyVerified: Boolean(data.is_fully_verified),
          contractName: data.name ?? null
        };
        console.log(
          explorerPanel.verified
            ? `    explorer panel: verified${explorerPanel.fullyVerified ? " (full match)" : ""}`
            : "    explorer panel: NOT verified"
        );
      } else {
        explorerPanel = { explorer: `${explorerApi}/address/${address}`, verified: false, error: `HTTP ${panel.status}` };
        console.log(`    explorer panel: unreadable (HTTP ${panel.status})`);
      }
    }

    contracts.push({
      contract: contractName,
      address,
      creationTransactionHash: txHash ?? null,
      compiler: compilerVersion,
      ok: outcome.ok,
      match: outcome.match,
      creationMatch: outcome.creationMatch,
      runtimeMatch: outcome.runtimeMatch,
      verifiedAt: outcome.verifiedAt,
      repository: outcome.ok ? outcome.link : null,
      forwarded: outcome.forwarded,
      explorerPanel,
      detail: outcome.detail
    });
    await sleep(1500);
  }
  return { lane: laneName, network: record.network, chainId: record.chainId, explorer: explorerApi, contracts };
}

const requested = arg("network", "all");
const laneNames = requested === "all" ? Object.keys(LANES) : [requested];
for (const name of laneNames) {
  if (!LANES[name]) {
    console.error(`Unknown lane "${name}". Known lanes: ${Object.keys(LANES).join(", ")}, all.`);
    process.exit(2);
  }
}

const lanes = [];
for (const name of laneNames) {
  lanes.push(await verifyLane(name, LANES[name]));
}

const verified = lanes.flatMap((lane) => lane.contracts).filter((entry) => entry.ok).length;
const total = lanes.flatMap((lane) => lane.contracts).filter((entry) => entry.contract).length;
const panels = lanes
  .flatMap((lane) => lane.contracts)
  .filter((entry) => entry.explorerPanel?.verified).length;
const report = {
  checkedAt: new Date().toISOString(),
  verifier: "sourcify.dev (keyless, standard JSON input, creation bytecode compared)",
  summary: { verified, total, explorerPanels: panels, lanes: lanes.length },
  lanes
};
writeFileSync(EVIDENCE, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  `\n${verified}/${total} contracts match on Sourcify; ${panels}/${total} also read as verified on their explorer panel. Wrote evidence/sourcify.json`
);

if (verified !== total) {
  console.error(
    "\nNot every contract is published. The submission copy must say so until this exits 0."
  );
  process.exitCode = 1;
}
