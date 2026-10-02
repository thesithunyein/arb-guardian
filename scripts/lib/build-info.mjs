/**
 * The compiler input that produced a deployed artifact.
 *
 * Two verification recorders need this, and both need it for the same reason: what a verifier
 * compares is the metadata hash taken over the exact source bytes that were compiled, so reading the
 * working tree instead of the build-info fails on nothing more than a line-ending change. Hardhat
 * writes a sibling `.dbg.json` pointing at the build-info for the compilation job, and that file
 * holds the full compiler input.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export function standardJsonInput(contractsDir, artifactPath) {
  const absolute = join(contractsDir, "artifacts", artifactPath);
  if (!existsSync(absolute)) {
    throw new Error(`No artifact at ${absolute}. Run "npm run build -w packages/contracts" first.`);
  }
  const debugPath = absolute.replace(/\.json$/, ".dbg.json");
  if (!existsSync(debugPath)) throw new Error(`No build-info pointer next to ${absolute}`);

  const { buildInfo } = JSON.parse(readFileSync(debugPath, "utf8"));
  const buildInfoPath = resolve(dirname(debugPath), buildInfo);
  const info = JSON.parse(readFileSync(buildInfoPath, "utf8"));
  const input = info.input;
  if (!input?.sources) throw new Error(`Build-info at ${buildInfoPath} has no compiler input`);

  return {
    stdJsonInput: { language: input.language, sources: input.sources, settings: input.settings },
    compilerVersion: info.solcLongVersion
  };
}

/**
 * ABI-encode address-only constructor arguments.
 *
 * Every contract in this deployment takes addresses and nothing else, so the encoding is the
 * 32-byte left-padded word per argument, which avoids pulling a coder into a script that otherwise
 * needs no dependencies.
 */
export function encodeAddressArgs(addresses) {
  return `0x${addresses
    .map((address) => address.toLowerCase().replace(/^0x/, "").padStart(64, "0"))
    .join("")}`;
}
