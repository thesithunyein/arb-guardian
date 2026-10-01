/**
 * Is the settlement token we advertise the token that is actually deployed?
 *
 * The submission copy says the treasury settles in USDG, and the token lane's limits are quoted
 * in USDG's units. Both of those are claims about a third party's contract on a testnet, so they
 * are exactly the kind of thing this repository refuses to assert in prose: either the address
 * answers `symbol()`/`decimals()` with what the manifest declares, or this fails.
 *
 * It matters more than a cosmetic label. A token lane configured with the wrong number of
 * decimals misreads every limit by a power of ten — a 5,000 USDG cap becomes 5 USDG, or 5 million.
 * The decimals are the part of the integration that a reader cannot eyeball.
 *
 * Reads no keys and sends no transactions: any public RPC will do.
 *
 * Exit codes: 0 every declared claim held (unreachable RPCs are reported, not passed silently),
 *             1 a claim was violated, or a declared token could not be read at all.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACTS = join(ROOT, "packages", "contracts");
const MANIFEST = join(CONTRACTS, "evidence", "live-deployments.json");
const REPORT = join(CONTRACTS, "evidence", "settlement-token.json");

const SELECTORS = {
  name: "0x06fdde03",
  symbol: "0x95d89b41",
  decimals: "0x313ce567",
  totalSupply: "0x18160ddd"
};

async function rpc(url, method, params) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(body.error.message ?? JSON.stringify(body.error));
  return body.result;
}

/** `call` with a timeout, so a dead RPC reports itself instead of hanging the run. */
async function call(url, to, data, timeoutMs = 12_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
      signal: controller.signal
    });
    const body = await response.json();
    if (body.error) throw new Error(body.error.message ?? JSON.stringify(body.error));
    return body.result;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * ERC-20 metadata is not as standard as it looks: `symbol()` and `name()` are dynamic strings on
 * most tokens and `bytes32` on a minority, and a few return nothing at all. Decode both shapes and
 * say so rather than guessing.
 */
function decodeString(hex) {
  if (!hex || hex === "0x") return "";
  const body = hex.slice(2);
  if (body.length === 64) {
    // bytes32: strip trailing zeros
    const raw = body.replace(/(00)+$/, "");
    return Buffer.from(raw, "hex").toString("utf8");
  }
  if (body.length < 128) return "";
  const offset = Number(BigInt(`0x${body.slice(0, 64)}`)) * 2;
  const length = Number(BigInt(`0x${body.slice(offset, offset + 64)}`));
  const data = body.slice(offset + 64, offset + 64 + length * 2);
  return Buffer.from(data, "hex").toString("utf8");
}

function decodeUint(hex) {
  if (!hex || hex === "0x") return null;
  return BigInt(hex);
}

async function readToken(network) {
  const token = network.settlementToken;
  const url = network.rpc;

  const code = await rpc(url, "eth_getCode", [token.address, "latest"]);
  const hasCode = Boolean(code) && code !== "0x";

  const [nameHex, symbolHex, decimalsHex, supplyHex] = await Promise.all([
    call(url, token.address, SELECTORS.name),
    call(url, token.address, SELECTORS.symbol),
    call(url, token.address, SELECTORS.decimals),
    call(url, token.address, SELECTORS.totalSupply)
  ]);

  const decimalsRaw = decodeUint(decimalsHex);

  return {
    address: token.address,
    declaredSymbol: token.symbol ?? null,
    declaredDecimals: token.decimals ?? null,
    declaredName: token.name ?? null,
    hasCode,
    name: decodeString(nameHex),
    symbol: decodeString(symbolHex),
    decimals: decimalsRaw === null ? null : Number(decimalsRaw & 0xffn),
    // Deliberately a flag rather than the figure: supply moves every time the issuer mints or
    // burns, and a committed artifact that changes on its own is one nobody can diff.
    supplyReadable: decodeUint(supplyHex) !== null,
    observedSupply: decodeUint(supplyHex)?.toString() ?? null
  };
}

function judge(network, read) {
  const problems = [];
  const token = network.settlementToken;

  if (!read.hasCode) {
    problems.push(`no contract code at ${token.address} on ${network.label}`);
  }
  if (read.decimals === null) {
    problems.push("decimals() did not return a value");
  } else if (token.decimals !== undefined && read.decimals !== token.decimals) {
    problems.push(
      `decimals() is ${read.decimals} but the manifest declares ${token.decimals} — every limit in this lane would be off by 10^${Math.abs(read.decimals - token.decimals)}`
    );
  }
  if (token.symbol && read.symbol !== token.symbol) {
    problems.push(`symbol() is "${read.symbol}" but the manifest declares "${token.symbol}"`);
  }
  return problems;
}

async function main() {
  if (!existsSync(MANIFEST)) {
    console.error(`No manifest at ${MANIFEST}`);
    process.exitCode = 1;
    return;
  }
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const networks = (manifest.networks ?? []).filter((n) => n.settlementToken?.address);

  if (networks.length === 0) {
    console.error("No network declares a settlementToken, so there is nothing to check.");
    process.exitCode = 1;
    return;
  }

  const report = {
    kind: "arb-guardian-settlement-token",
    generatedAt: new Date().toISOString(),
    networks: []
  };
  let violated = 0;

  for (const network of networks) {
    const token = network.settlementToken;
    process.stdout.write(`\n--- ${network.label} · ${token.label ?? "settlement token"} @ ${token.address}\n`);
    try {
      const read = await readToken(network);
      const problems = judge(network, read);
      if (problems.length > 0) violated += 1;

      report.networks.push({
        network: network.name,
        label: network.label,
        chainId: network.chainId,
        explorer: network.explorer,
        ...read,
        observedSupply: undefined,
        problems
      });

      console.log(`    symbol=${read.symbol || "(none)"} decimals=${read.decimals ?? "(none)"} code=${read.hasCode}`);
      if (problems.length === 0) {
        console.log(`    OK — matches the manifest. Total supply at this block: ${read.observedSupply ?? "unreadable"}.`);
      } else {
        for (const problem of problems) console.error(`    MISMATCH: ${problem}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`    could not read: ${message}`);
      report.networks.push({
        network: network.name,
        label: network.label,
        chainId: network.chainId,
        explorer: network.explorer,
        address: token.address,
        declaredSymbol: token.symbol ?? null,
        declaredDecimals: token.decimals ?? null,
        readFailed: message,
        problems: [`could not read the token: ${message}`]
      });
      violated += 1;
    }
  }

  mkdirSync(dirname(REPORT), { recursive: true });

  // Same contract as the guard proof: if nothing but the clock moved, keep the timestamp that is
  // already committed, so re-running leaves the file byte-identical and a real change is the only
  // thing that shows up in `git diff`.
  const withoutTimestamp = (value) =>
    JSON.stringify({ ...value, generatedAt: "" }, (key, item) => (key === "observedSupply" ? undefined : item));
  try {
    const existing = JSON.parse(readFileSync(REPORT, "utf8"));
    if (existing.generatedAt && withoutTimestamp(existing) === withoutTimestamp(report)) {
      report.generatedAt = existing.generatedAt;
    }
  } catch {
    // First run, or an unreadable report: write a fresh one.
  }

  writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(`\nWrote ${REPORT}`);
  if (violated > 0) {
    console.error(
      `\n${violated} of ${networks.length} settlement token claims did NOT hold. The submission copy quotes limits in ` +
        "this token's units, so fix the manifest or the address before the lanes are used."
    );
    process.exitCode = 1;
  } else {
    console.log(`\nAll ${networks.length} settlement token claims hold.`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
