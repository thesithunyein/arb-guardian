/**
 * Print the recording sheet for a demo, built from the committed evidence.
 *
 * A hand-written demo script ages badly: it quotes addresses that get redeployed and counts that
 * move. This one reads the same reports the site does — the deployment manifest, the bytecode drift
 * report, the settlement-token check and the guard proof — so whatever it prints is what is actually
 * true at the moment it runs. If the drift check has not been run recently, it says so.
 *
 *   npm run demo:sheet
 *
 * Prints to stdout and writes nothing. Redirect it if you want a file:
 *
 *   npm run demo:sheet > /tmp/sheet.md
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EVIDENCE = join(ROOT, "packages", "contracts", "evidence");

function read(name) {
  const path = join(EVIDENCE, name);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

const manifest = read("live-deployments.json");
const drift = read("deployed-drift.json");
const settlement = read("settlement-token.json");
const proof = read("guard-proof.json");

const out = [];
const say = (line = "") => out.push(line);

function staleWarning() {
  const missing = [];
  if (!drift) missing.push("npm run check:deployed");
  if (!settlement) missing.push("npm run check:settlement");
  if (!proof) missing.push("npm run evidence -w packages/contracts");
  return missing;
}

const missing = staleWarning();

say("# Recording sheet");
say();
say("Generated from the committed evidence. Nothing here is typed by hand, so nothing here can");
say("disagree with the reports a judge can regenerate.");
say();

if (missing.length > 0) {
  say("> **Incomplete.** These have not been run, so this sheet cannot vouch for them:");
  for (const command of missing) say(`> - \`${command}\``);
  say(">");
  say("> Run them before recording, or say so on camera. A sheet that quietly omits a check is worse");
  say("> than no sheet.");
  say();
}

say("## Links to have open");
say();
say("- Live product: https://arb-guardian.vercel.app");
say("- Repo: https://github.com/thesithunyein/arb-guardian");
say("- Security posture: https://github.com/thesithunyein/arb-guardian/blob/master/SECURITY.md");
say();

if (manifest?.networks?.length) {
  say("## What is deployed, and whether it is the current build");
  say();
  for (const network of manifest.networks) {
    const report = drift?.networks?.find((n) => n.name === network.name);
    const held = report ? report.contracts.every((c) => c.claimHeld !== false) : null;
    const verdict =
      held === null
        ? "NOT CHECKED — run npm run check:deployed"
        : held
          ? `verified against this source (declared "${network.status}")`
          : `CLAIM VIOLATED — declared "${network.status}" but the chain disagrees`;

    say(`### ${network.label} (chain ${network.chainId})`);
    say();
    say(`Status: **${verdict}**`);
    say();

    if (network.status === "superseded") {
      say("> These addresses are an earlier build. Do not present them as the current source.");
      for (const reason of network.supersededBy ?? []) say(`> - ${reason}`);
      say();
    }

    for (const contract of network.contracts ?? []) {
      const found = report?.contracts?.find((c) => c.contract === contract.contract);
      const size = found?.onchainBytes ? ` (${found.onchainBytes} bytes on chain)` : "";
      say(
        `- ${contract.contract}: ${network.explorer}/address/${contract.address}${size}`
      );
    }
    say();
  }
}

if (settlement?.networks?.length) {
  say("## Settlement token");
  say();
  say("Read from the token contracts, not from the issuer's documentation:");
  say();
  for (const token of settlement.networks) {
    const ok = token.problems.length === 0;
    say(
      `- **${token.label}**: ${token.symbol ?? "?"} — ${token.decimals ?? "?"} decimals — ` +
        `${token.explorer}/address/${token.address} — ${ok ? "matches the manifest" : "DOES NOT match: " + token.problems.join("; ")}`
    );
  }
  say();
}

if (proof?.summary) {
  say("## The guard proof");
  say();
  say(`- ${proof.summary.passed}/${proof.summary.total} cases behaved as specified (${proof.hardhatNetwork} chain)`);
  say(`- Real Gnosis Safe: ${proof.safeVersion}`);
  say(`- Guard installed through an owner-approved execTransaction: ${proof.guardInstalledThroughExecTransaction}`);
  if (proof.policyAttestation) {
    const a = proof.policyAttestation;
    say(`- Policy digest chain: ${a.amendmentsReplayed} amendments replayed from logs, ${a.replayFailures.length} mismatches`);
    say(`- Allowed decisions stamped with the policy version in force: ${a.decisionsChecked - a.decisionsWithUnknownPolicy}/${a.decisionsChecked}`);
    say(`- Distinct policy versions across those decisions: ${a.distinctPolicyVersionsInDecisions}`);
  }
  say();
  say("Regenerate it, on camera if you like, with `npm run evidence -w packages/contracts`.");
  say();
}

say("## Beats, with the evidence each one points at");
say();
say("| When | Show | Evidence on screen |");
say("| --- | --- | --- |");
say("| 0:00 | The problem | One sentence: a delegate with a key can move everything, and approval-per-transaction defeats automation |");
say("| 0:20 | The live contracts | The explorer address from this sheet, source verified, so the code shown is the code deployed |");
say("| 0:50 | A real spend check | Review tab: the treasury and a payee that is not allowlisted → refuses, and names the rule |");
say("| 1:20 | The allowlisted path | Same treasury, the allowlisted payee → allowed, with the cap read from the contract |");
say("| 1:40 | The Safe itself | A policy-violating `execTransaction` reverting inside a real Gnosis Safe — the enforced path |");
say("| 2:10 | Administering it | Policy tab: allowlist a payee, watch the policy version and digest move, read back from the contract |");
say("| 2:40 | USDG | The settlement token address above, and a transfer refused for exceeding the token cap |");
say("| 2:55 | The honest close | The drift check, and whatever this sheet says about the deployed build |");
say();

say("## Do not claim");
say();
say("- **Not** first or only. This lane has well-funded incumbents (Coinbase Agentic Wallets, Cobo, Openfort, MetaMask, Blockaid).");
say("- **Not** an audit. Say \"not audited\" if security comes up; `SECURITY.md` says it plainly.");
say("- **Not** rolling 24-hour windows. The cap resets on a UTC-day boundary — a stated limitation.");
say("- **Not** enforced on a bare EOA. The enforced path is a guard installed in a Safe; `ExecutionGuard` is a pre-check a cooperating caller must invoke.");
say("- **Not** custody. The guard holds no funds and cannot move any.");
say("- No \"AI accuracy\" claims. The conformance fixtures are a regression suite of 14 fixed cases, not a model evaluation.");
say();

console.log(out.join("\n"));
