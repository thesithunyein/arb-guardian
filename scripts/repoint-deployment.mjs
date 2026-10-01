/**
 * Point everything at a fresh deployment, then prove it.
 *
 * After a deploy, three things have to agree: the deployment record Hardhat wrote, the manifest the
 * drift check and the site read, and the addresses hardcoded in the web app. Doing that by hand goes
 * wrong in the boring way — one address updated and another left on the superseded build, leaving a
 * submission that confidently describes the wrong contract. This does all three from one source, the
 * deployment record, and then runs the checks that would catch it.
 *
 *   npm run repoint -- --dry-run   # show every change, write nothing
 *   npm run repoint                # write, then verify against the chain
 *
 * Refuses to touch anything for a record that is not a real network: a `deploy.ts` run on the
 * in-process chain leaves a record behind, and that record must never become the product's
 * deployment.
 *
 * Exit codes: 0 repointed and verified, 1 refused or a check failed.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACTS = join(ROOT, "packages", "contracts");
const MANIFEST = join(CONTRACTS, "evidence", "live-deployments.json");
const DRIFT_REPORT = join(CONTRACTS, "evidence", "deployed-drift.json");
const CONFIG = join(ROOT, "apps", "web", "src", "config.ts");
const WEB_ENV = join(ROOT, "apps", "web", ".env.local");

const DRY_RUN = process.argv.includes("--dry-run");

/**
 * Which record field feeds which constant. `null` means the field is optional and its absence is
 * reported rather than written as an empty string.
 */
const LANES = [
  {
    name: "arbitrumSepolia",
    record: join(CONTRACTS, "deployments", "arbitrumSepolia.json"),
    chainId: 421614,
    explorer: "https://sepolia.arbiscan.io",
    prefix: "",
    envPrefix: "VITE_"
  },
  {
    name: "robinhoodTestnet",
    record: join(CONTRACTS, "deployments", "robinhoodTestnet.json"),
    chainId: 46630,
    explorer: "https://explorer.testnet.chain.robinhood.com",
    prefix: "RH_",
    envPrefix: "VITE_RH_"
  }
];

const FIELD_MAP = [
  ["POLICY_MANAGER", (d) => d.policyManager?.address, "VITE_POLICY_MANAGER_ADDRESS"],
  ["EXECUTION_GUARD", (d) => d.executionGuard?.address, "VITE_EXECUTION_GUARD_ADDRESS"],
  ["SAFE_TREASURY_GUARD", (d) => d.safeTreasuryGuard?.address, "VITE_SAFE_TREASURY_GUARD_ADDRESS"],
  ["TREASURY_SAFE", (d) => d.treasurySafeShell?.address, "VITE_TREASURY_SAFE_ADDRESS"],
  ["POLICY_MANAGER_TX", (d) => d.policyManager?.txHash, "VITE_POLICY_MANAGER_TX"],
  ["EXECUTION_GUARD_TX", (d) => d.executionGuard?.txHash, "VITE_EXECUTION_GUARD_TX"],
  ["SAFE_TREASURY_GUARD_TX", (d) => d.safeTreasuryGuard?.txHash, "VITE_SAFE_TREASURY_GUARD_TX"],
  ["TREASURY_SAFE_TX", (d) => d.treasurySafeShell?.deployTxHash, "VITE_TREASURY_SAFE_TX"],
  ["SAFE_ENROLLMENT_TX", (d) => d.treasurySafeShell?.enrollmentTxHash, "VITE_SAFE_ENROLLMENT_TX"],
  ["SAFE_SET_GUARD_TX", (d) => d.treasurySafeShell?.setGuardTxHash, "VITE_SAFE_SET_GUARD_TX"],
  ["SAFE_ALLOWED_EXEC_TX", (d) => d.treasurySafeShell?.allowedExecTxHash, "VITE_SAFE_ALLOWED_EXEC_TX"]
];

/**
 * Replace the hardcoded fallback in `export const NAME = … "0x…";` and leave the env lookup alone.
 *
 * Three outcomes, because they mean different things: `replaced` worked; `absent` means the app does
 * not track that value for this lane at all — the Robinhood constants carry no Safe-shell hashes, for
 * instance — and is a note rather than an error; `unmatched` means the constant exists but no longer
 * matches the shape this script expects, which is a change to the file that must not be skipped.
 */
function replaceFallback(source, constant, value) {
  if (!new RegExp(`export const ${constant} =`).test(source)) return { source, result: "absent" };
  const pattern = new RegExp(`(export const ${constant} =[\\s\\S]*?")0x[0-9a-fA-F]{40,64}(";)`);
  if (!pattern.test(source)) return { source, result: "unmatched" };
  return { source: source.replace(pattern, `$1${value}$2`), result: "replaced" };
}

function readRecord(lane) {
  if (!existsSync(lane.record)) {
    return { lane, missing: true };
  }
  const record = JSON.parse(readFileSync(lane.record, "utf8"));
  if (record.chainId !== lane.chainId) {
    return {
      lane,
      wrongNetwork: `record says chain ${record.chainId}, ${lane.name} is ${lane.chainId}`
    };
  }
  return { lane, record };
}

function main() {
  if (!existsSync(MANIFEST)) {
    console.error(`No manifest at ${MANIFEST}`);
    process.exitCode = 1;
    return;
  }

  const records = LANES.map(readRecord);
  const usable = records.filter((entry) => entry.record);
  const skipped = records.filter((entry) => !entry.record);

  for (const entry of skipped) {
    const reason = entry.missing
      ? `no deployment record at ${entry.lane.record} — deploy to that network first`
      : entry.wrongNetwork;
    console.log(`skipping ${entry.lane.name}: ${reason}`);
  }

  if (usable.length === 0) {
    console.error(
      "\nNothing to repoint. Run `npm run redeploy:sepolia` (and `npm run redeploy:robinhood`) first, " +
        "then run this again."
    );
    process.exitCode = 1;
    return;
  }

  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  let configSource = readFileSync(CONFIG, "utf8");
  const changes = [];
  const envLines = [];
  const unmatched = [];
  const absent = [];

  for (const { lane, record } of usable) {
    let replaced = 0;
    const network = (manifest.networks ?? []).find((n) => n.name === lane.name);
    if (!network) {
      console.warn(`manifest has no entry for ${lane.name}; leaving it alone`);
      continue;
    }

    // ---- the manifest: addresses, transaction hashes, and the status claim
    const previous = (network.contracts ?? []).map((c) => ({ contract: c.contract, address: c.address }));
    const addresses = {
      PolicyManager: record.policyManager?.address,
      ExecutionGuard: record.executionGuard?.address,
      SafeTreasuryGuard: record.safeTreasuryGuard?.address
    };
    const txHashes = {
      PolicyManager: record.policyManager?.txHash ?? null,
      ExecutionGuard: record.executionGuard?.txHash ?? null,
      SafeTreasuryGuard: record.safeTreasuryGuard?.txHash ?? null
    };

    network.contracts = Object.entries(addresses).map(([contract, address]) => ({
      contract,
      address,
      txHash: txHashes[contract]
    }));
    network.status = "current";
    network.deployedAt = new Date().toISOString().slice(0, 10);
    network.replaced = previous.length > 0 ? previous : undefined;
    delete network.supersededBy;

    changes.push(
      `${lane.name}: manifest now points at ${addresses.PolicyManager} / ${addresses.ExecutionGuard} / ${addresses.SafeTreasuryGuard}, status "current"`
    );

    // ---- the app: the committed fallbacks, so a clone points at the live deployment
    for (const [constant, pick, envName] of FIELD_MAP) {
      const value = pick(record);
      if (!value) {
        absent.push(`${lane.prefix}${constant}`);
        continue;
      }
      const result = replaceFallback(configSource, `${lane.prefix}${constant}`, value);
      if (result.result === "replaced") {
        configSource = result.source;
        replaced += 1;
        envLines.push(`${lane.envPrefix}${envName.replace(/^VITE_(RH_)?/, "")}=${value}`);
      } else if (result.result === "absent") {
        absent.push(`${lane.prefix}${constant}`);
      } else {
        unmatched.push(`${lane.prefix}${constant}`);
      }
    }
    changes.push(`${lane.name}: ${replaced} constants in apps/web/src/config.ts repointed`);
  }

  if (unmatched.length > 0) {
    console.error(
      `\nCannot repoint: these constants exist in apps/web/src/config.ts but no longer match the shape ` +
        `this script expects — ${unmatched.join(", ")}. Fix the script rather than editing the file by hand, ` +
        "or the next deploy will miss them too."
    );
    process.exitCode = 1;
    return;
  }

  if (absent.length > 0) {
    console.warn(`\nnote: no value in the deployment record for ${absent.join(", ")} — left as they were.`);
  }

  console.log("");
  for (const change of changes) console.log(`  ${change}`);
  console.log("");

  if (DRY_RUN) {
    console.log("Dry run — nothing written. Re-run without --dry-run to apply.");
    return;
  }

  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  writeFileSync(CONFIG, configSource, "utf8");
  console.log(`Wrote ${MANIFEST}`);
  console.log(`Wrote ${CONFIG}`);

  // Local dev reads these; Vite picks the file up without a commit.
  writeFileSync(WEB_ENV, `${[...new Set(envLines)].join("\n")}\n`, "utf8");
  console.log(`Wrote ${WEB_ENV} (gitignored — for local dev only)`);

  console.log("\n--- proving it, against the chain\n");
  for (const command of ["check:deployed", "check:settlement"]) {
    const result = spawnSync("npm", ["run", command], { cwd: ROOT, stdio: "inherit", shell: true });
    if (result.status !== 0) {
      console.error(
        `\n${command} failed. The manifest now claims "current" for a build the chain disagrees with — ` +
          "that is the check doing its job. Fix the addresses before pushing."
      );
      process.exitCode = 1;
      return;
    }
  }

  // An exit code is not enough here. The drift check deliberately exits 0 when an RPC is unreachable,
  // because a network blip should not fail CI — it reports those claims as "not evaluated" instead.
  // This script has just rewritten the manifest to assert that these addresses ARE the current build,
  // so "not evaluated" is not good enough: reading the report is the difference between verifying
  // that claim and merely announcing it.
  const declaredCurrent = new Set(usable.map((entry) => entry.lane.name));
  let drift;
  try {
    drift = JSON.parse(readFileSync(DRIFT_REPORT, "utf8"));
  } catch {
    console.error(`\nCould not read ${DRIFT_REPORT}, so nothing was verified.`);
    process.exitCode = 1;
    return;
  }

  const mine = (drift.networks ?? []).filter((network) => declaredCurrent.has(network.name));
  const unevaluated = mine.filter((network) => !network.reachable);
  const violated = mine.filter((network) => (network.contracts ?? []).some((c) => c.claimHeld === false));

  if (unevaluated.length > 0) {
    console.error(
      `\nNOT VERIFIED: the chain could not be reached for ${unevaluated
        .map((n) => n.label)
        .join(", ")}, so no claim was evaluated. The manifest is written, but do not push or point the\n` +
        "site at these addresses until `npm run check:deployed` reports every contract as matched."
    );
    process.exitCode = 1;
    return;
  }

  if (violated.length > 0) {
    console.error(`\nNOT VERIFIED: the chain disagrees with the manifest on ${violated.map((n) => n.label).join(", ")}.`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `\nVerified: ${mine.reduce((sum, n) => sum + (n.contracts?.length ?? 0), 0)} contract(s) at the recorded addresses ` +
      "match this build."
  );

  console.log("\nSet these in the Vercel project so the deployed site reads the same addresses:\n");
  for (const line of [...new Set(envLines)]) console.log(`  ${line}`);
  console.log("\nThen run the live tests: npm run test -w apps/api");
}

main();
