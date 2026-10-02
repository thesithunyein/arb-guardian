/**
 * Publish the Arbitrum Sepolia sources on Arbiscan, and record what Arbiscan answered.
 *
 * Arbiscan is the panel a judge is most likely to open, and it is the one panel still unpublished —
 * it needs `ARBISCAN_API_KEY` and nothing else. This script exists so that adding the key is the
 * whole task: it submits all three contracts from the compiler's own standard JSON input, waits for
 * the queue, reads the result back from Arbiscan rather than assuming it, and writes the outcome to
 * `evidence/arbiscan.json`, which the site renders next to the Sourcify record.
 *
 * It is written to be run *before* the key exists too. With no key it records `pending_key`, keeps
 * any earlier confirmed publication (a key that has gone missing must not erase a fact), prints the
 * one command that would finish the job, and exits 0 — so it can sit inside the normal preflight
 * without breaking the build of someone who has not signed up for an API key.
 *
 * Usage:
 *   node scripts/verify-arbiscan.mjs                 # submit, poll, record
 *   node scripts/verify-arbiscan.mjs --status-only    # never submit; only read the panels back
 *   node scripts/verify-arbiscan.mjs --verbose
 *
 * Exit codes: 0 published, or pending a key; 1 a submission or read failed while a key was present.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeAddressArgs, standardJsonInput } from "./lib/build-info.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACTS = join(ROOT, "packages", "contracts");
const EVIDENCE = join(CONTRACTS, "evidence", "arbiscan.json");
const DEPLOYMENT = join(CONTRACTS, "deployments", "arbitrumSepolia.json");
const EXPLORER = "https://sepolia.arbiscan.io";
const API = "https://api.etherscan.io/v2/api";

/**
 * Constructor arguments, in the order the deploy script passes them. Addresses only, so the encoding
 * is the 32-byte left-padded word per argument.
 */
const TARGETS = [
  {
    contract: "PolicyManager",
    artifact: "contracts/PolicyManager.sol/PolicyManager.json",
    identifier: "contracts/PolicyManager.sol:PolicyManager",
    recordKey: "policyManager",
    args: (record) => [record.deployer]
  },
  {
    contract: "ExecutionGuard",
    artifact: "contracts/ExecutionGuard.sol/ExecutionGuard.json",
    identifier: "contracts/ExecutionGuard.sol:ExecutionGuard",
    recordKey: "executionGuard",
    args: (record) => [record.deployer, record.policyManager.address]
  },
  {
    contract: "SafeTreasuryGuard",
    artifact: "contracts/SafeTreasuryGuard.sol/SafeTreasuryGuard.json",
    identifier: "contracts/SafeTreasuryGuard.sol:SafeTreasuryGuard",
    recordKey: "safeTreasuryGuard",
    args: (record) => [record.deployer, record.policyManager.address]
  }
];

const has = (flag) => process.argv.includes(`--${flag}`);
const verbose = has("verbose");
const statusOnly = has("status-only");
const dryRun = has("dry-run");
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function api(params) {
  const url = `${API}?${new URLSearchParams(params).toString()}`;
  const response = await fetch(url);
  const text = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // reported raw
  }
  return { status: response.status, body: parsed, text };
}

async function apiPost(form) {
  const response = await fetch(API, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString()
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // reported raw
  }
  return { status: response.status, body: parsed, text };
}

/** Read what Arbiscan says about a contract, independent of any submission we made. */
async function readPanel(chainId, apiKey, address) {
  const result = await api({
    chainid: String(chainId),
    module: "contract",
    action: "getsourcecode",
    address,
    apikey: apiKey
  });
  const entry = result.body?.result?.[0];
  if (!entry) return { published: null, status: result.body?.message ?? `HTTP ${result.status}`, error: result.body?.result ?? null };
  const source = typeof entry.SourceCode === "string" ? entry.SourceCode.trim() : "";
  const abi = typeof entry.ABI === "string" ? entry.ABI : "";
  const unverified = abi.includes("Contract source code not verified");
  return {
    published: source.length > 0 && !unverified,
    status: unverified ? "not_verified" : source.length > 0 ? "verified" : "unknown",
    contractName: entry.ContractName || null,
    compiler: entry.CompilerVersion || null,
    error: null
  };
}

/**
 * Build the submission Etherscan expects.
 *
 * `sourceCode` is the standard JSON input as a string, `contractname` is the qualified identifier,
 * and the parameter that carries the constructor arguments is spelled the way the API defines it —
 * typo included, because guessing the correct spelling returns a validation error instead.
 */
function buildForm(chainId, apiKey, target, address, constructorArgs) {
  const { stdJsonInput, compilerVersion } = standardJsonInput(CONTRACTS, target.artifact);
  const sourceCode = JSON.stringify(stdJsonInput);
  return {
    form: {
      chainid: String(chainId),
      module: "contract",
      action: "verifysourcecode",
      apikey: apiKey,
      codeformat: "solidity-standard-json-input",
      sourceCode,
      contractaddress: address,
      contractname: target.identifier,
      compilerversion: `v${compilerVersion}`,
      constructorArguements: encodeAddressArgs(constructorArgs)
    },
    summary: {
      endpoint: `${API}?chainid=${chainId}`,
      action: "verifysourcecode",
      codeformat: "solidity-standard-json-input",
      contractaddress: address,
      contractname: target.identifier,
      compilerversion: `v${compilerVersion}`,
      constructorArguements: encodeAddressArgs(constructorArgs),
      sources: Object.keys(stdJsonInput.sources ?? {}),
      settings: Object.keys(stdJsonInput.settings ?? {}),
      sourceCodeBytes: sourceCode.length
    }
  };
}

async function submit(chainId, apiKey, target, address, constructorArgs) {
  const { form } = buildForm(chainId, apiKey, target, address, constructorArgs);
  const response = await apiPost(form);
  const message = `${response.body?.result ?? response.text}`.trim();
  if (verbose) console.log(`    submit: ${message.slice(0, 200)}`);
  if (/already verified/i.test(message)) return { guid: null, alreadyVerified: true, message };
  if (String(response.body?.status) !== "1") return { guid: null, alreadyVerified: false, message };
  return { guid: message, alreadyVerified: false, message };
}

async function pollStatus(chainId, apiKey, guid) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await api({
      chainid: String(chainId),
      module: "contract",
      action: "checkverifystatus",
      guid,
      apikey: apiKey
    });
    const message = `${result.body?.result ?? result.text}`.trim();
    if (verbose) console.log(`    poll ${attempt + 1}: ${message.slice(0, 160)}`);
    if (/pass - verified/i.test(message) || /fail/i.test(message) || /already verified/i.test(message)) {
      return message;
    }
    await sleep(3000);
  }
  return "Pending in queue";
}

function previousReport() {
  if (!existsSync(EVIDENCE)) return null;
  try {
    return JSON.parse(readFileSync(EVIDENCE, "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  if (!existsSync(DEPLOYMENT)) {
    throw new Error(`No deployment record at ${DEPLOYMENT}; run the deploy script first.`);
  }
  const record = JSON.parse(readFileSync(DEPLOYMENT, "utf8"));
  const apiKey = (process.env.ARBISCAN_API_KEY ?? "").trim();
  const prior = previousReport();
  const priorByAddress = new Map((prior?.contracts ?? []).map((c) => [c.address.toLowerCase(), c]));

  console.log(`\nArbiscan source verification · ${record.network} (chain ${record.chainId})`);
  console.log(`  explorer   ${EXPLORER}`);
  console.log(`  api key    ${apiKey ? "present" : "absent (ARBISCAN_API_KEY)"}`);
  console.log(
    `  mode       ${dryRun ? "dry run (build the request, send nothing)" : statusOnly ? "status only (no submissions)" : "submit + verify"}`
  );

  const contracts = [];
  for (const target of TARGETS) {
    const { address } = record[target.recordKey] ?? {};
    const before = priorByAddress.get(String(address).toLowerCase());
    const entry = {
      contract: target.contract,
      address,
      explorer: `${EXPLORER}/address/${address}`,
      identifier: target.identifier,
      published: null,
      publishedAt: before?.published ? before.publishedAt ?? null : null,
      status: "unread",
      guid: null,
      checkedAt: new Date().toISOString(),
      readBack: null,
      error: null
    };

    if (!address) {
      entry.status = "missing_from_deployment";
      entry.error = "not in the deployment record";
      contracts.push(entry);
      continue;
    }

    console.log(`  ${target.contract} @ ${address}`);

    // A dry run exists so the submission can be inspected before a key is available at all: it
    // builds the exact request and sends nothing.
    if (dryRun) {
      entry.request = buildForm(record.chainId, apiKey, target, address, target.args(record)).summary;
      entry.status = "dry_run";
      entry.error = "dry run: the request was built and not sent";
      contracts.push(entry);
      console.log(
        `    would submit ${entry.request.contractname} · ${entry.request.sources.length} sources · ${entry.request.compilerversion}`
      );
      console.log(`    constructorArguements ${entry.request.constructorArguements}`);
      continue;
    }

    if (!apiKey) {
      entry.status = "pending_key";
      contracts.push(entry);
      console.log("    not read — needs ARBISCAN_API_KEY");
      continue;
    }

    // A contract can already be published by an earlier run, by Sourcify's forward, or by hand.
    const panelFirst = await readPanel(record.chainId, apiKey, address);
    if (panelFirst.published) {
      entry.published = true;
      entry.publishedAt = before?.publishedAt ?? new Date().toISOString();
      entry.status = "verified";
      entry.readBack = panelFirst;
      contracts.push(entry);
      console.log(`    already published on the explorer (${panelFirst.contractName ?? target.contract})`);
      continue;
    }

    if (statusOnly) {
      entry.status = "not_published";
      entry.readBack = panelFirst;
      entry.error = "read back as unverified; --status-only does not submit";
      contracts.push(entry);
      console.log("    NOT published (status-only run: nothing submitted)");
      continue;
    }

    const submitted = await submit(record.chainId, apiKey, target, address, target.args(record));
    if (!submitted.guid && !submitted.alreadyVerified) {
      entry.status = "submit_failed";
      entry.error = submitted.message.slice(0, 500);
      contracts.push(entry);
      console.log(`    submission failed — ${entry.error}`);
      continue;
    }

    entry.guid = submitted.guid;
    entry.status = submitted.alreadyVerified ? "already_verified" : "submitted";
    const verdict = submitted.guid ? await pollStatus(record.chainId, apiKey, submitted.guid) : "Already Verified";
    entry.status = verdict;

    const readBack = await readPanel(record.chainId, apiKey, address);
    entry.readBack = readBack;
    if (readBack.published) {
      entry.published = true;
      entry.publishedAt = new Date().toISOString();
      console.log(`    published · ${verdict}`);
    } else {
      entry.published = false;
      if (!entry.error) entry.error = `explorer still reports unverified after: ${verdict}`;
      console.log(`    NOT published · ${verdict}`);
    }
    contracts.push(entry);
    await sleep(1500);
  }

  const published = contracts.filter((c) => c.published === true).length;
  const total = contracts.length;
  const report = {
    checkedAt: new Date().toISOString(),
    network: record.network,
    chainId: record.chainId,
    explorer: EXPLORER,
    method: "Etherscan API v2 verifysourcecode (solidity-standard-json-input), read back via getsourcecode",
    blockedOn: apiKey ? null : "ARBISCAN_API_KEY",
    summary: {
      published,
      total,
      pendingKey: contracts.filter((c) => c.status === "pending_key").length,
      unread: contracts.filter((c) => c.status === "unread" || c.status === "pending_key").length
    },
    contracts
  };
  writeFileSync(EVIDENCE, `${JSON.stringify(report, null, 2)}\n`);

  console.log(
    `\n${published}/${total} contracts published on Arbiscan. Wrote evidence/arbiscan.json`
  );
  if (!apiKey) {
    console.log(
      "One step remains and it cannot be taken from here: set ARBISCAN_API_KEY, then run\n" +
        "  npm run verify:arbiscan\n" +
        "This script will then submit, wait, read the result back, and update the site's record."
    );
    return;
  }

  if (dryRun) {
    console.log("\nDry run: nothing was submitted, so nothing was recorded as published.");
    return;
  }

  const failed = contracts.filter((c) => c.published !== true);
  if (failed.length > 0) {
    console.error(
      `\n${failed.length} of ${total} contracts are not published on Arbiscan: ` +
        `${failed.map((c) => c.contract).join(", ")}. The site must keep saying so; fix or retry.`
    );
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
