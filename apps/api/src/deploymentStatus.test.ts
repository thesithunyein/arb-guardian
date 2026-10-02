/**
 * Which deployment the product thinks it is talking to.
 *
 * This regressed once, quietly. Running `hardhat run scripts/deploy.ts` locally leaves
 * `packages/contracts/deployments/latest.json` behind describing a throwaway chain with id
 * 31337. The API read that as the deployment, `getChainConfig()` then rejected it for not
 * being Arbitrum, and the live policy-client checks skipped instead of running — a skip that
 * looks exactly like a pass. These tests pin the precedence.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { getDeploymentStatus } from "./deploymentStatus.js";

// These tests write real `latest.json` files that the API reads, so they write them into a
// scratch directory. Pointing `ARB_GUARDIAN_DEPLOYMENTS_DIR` there keeps a test run from
// leaving a record behind in `packages/contracts/deployments/` — the exact artifact that
// once shadowed the real deployment — and keeps concurrent test files from seeing it.
let scratch = "";
const savedOverride = process.env.ARB_GUARDIAN_DEPLOYMENTS_DIR;

beforeAll(() => {
  scratch = mkdtempSync(resolve(tmpdir(), "arb-guardian-deployments-"));
  process.env.ARB_GUARDIAN_DEPLOYMENTS_DIR = scratch;
});

afterAll(() => {
  if (savedOverride === undefined) delete process.env.ARB_GUARDIAN_DEPLOYMENTS_DIR;
  else process.env.ARB_GUARDIAN_DEPLOYMENTS_DIR = savedOverride;
});

function withLatest(record: unknown) {
  writeFileSync(resolve(scratch, "latest.json"), JSON.stringify(record), "utf8");
}

afterEach(() => {
  // Each case starts from "no local record" unless it writes one.
  writeFileSync(resolve(scratch, "latest.json"), "null", "utf8");
});

describe("deployment status precedence", () => {
  it("resolves the committed manifest when nothing else is configured", () => {
    // No env vars and no local record in CI: the manifest is the source of truth.
    const status = getDeploymentStatus();
    expect(status.chainId).toBe(421614);
    expect(["live-manifest", "local-file", "env"]).toContain(status.source);

    // `ready` follows what the manifest declares, and is deliberately not inferred from the
    // presence of addresses: that inference is how a recorded, superseded deployment gets
    // presented as current enforcement. This assertion holds on both sides of a real redeploy.
    expect(status.ready).toBe(status.status === "current");
  });

  it("ignores a local record for a throwaway chain", () => {
    withLatest({
      network: "localhost",
      chainId: 31337,
      deployer: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      policyManager: { address: "0x5FbDB2315678afecb367f032d93F642f64180aa3" },
      executionGuard: { address: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512" }
    });

    const status = getDeploymentStatus();

    // The point: the throwaway record must not win, or every live check downstream skips.
    expect(status.chainId).not.toBe(31337);
    expect(status.policyManager).not.toBe("0x5FbDB2315678afecb367f032d93F642f64180aa3");
    expect(status.chainId).toBe(421614);
  });

  it("still honours a local record for a real network", () => {
    withLatest({
      network: "arbitrumSepolia",
      chainId: 421614,
      deployer: "0x1111111111111111111111111111111111111111",
      policyManager: { address: "0x2222222222222222222222222222222222222222", txHash: "0xtx" },
      executionGuard: { address: "0x3333333333333333333333333333333333333333" }
    });

    const status = getDeploymentStatus();

    // A fresh Arbitrum Sepolia deploy must be picked up, which is the redeploy path.
    expect(status.policyManager).toBe("0x2222222222222222222222222222222222222222");
    expect(status.source).toBe("local-file");

    // Addresses resolve, but readiness does not: a local deploy record is a build artifact with
    // no verification behind it. `npm run repoint` promotes it once the chain proves it matches.
    expect(status.status).toBe("unknown");
    expect(status.ready).toBe(false);
  });
});
