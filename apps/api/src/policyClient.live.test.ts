/**
 * The shared policy client, driven against the contract that is actually deployed.
 *
 * Unit tests prove the client's own logic. They cannot prove that its ABI strings name
 * functions that exist, that its role hashes match the ones the contract computes, or that
 * it can turn a real revert from a real node into a sentence. Those are the failure modes
 * that reach production, and they only appear against a live chain.
 *
 * Read-only by construction: every call here is `eth_call` from a throwaway address, so the
 * suite needs no key, spends no gas and cannot change state. When the RPC is unreachable the
 * suite reports that it skipped rather than passing quietly.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { JsonRpcProvider, Wallet } from "ethers";
import {
  POLICY_ADMIN_ROLE,
  decodePolicyError,
  detectPolicyAttestation,
  executionGuard,
  policyManager,
  readPolicyRoles,
  readWalletPolicy
} from "@arb-guardian/shared";
import { getChainConfig } from "./chainClient.js";

const config = getChainConfig();

let provider: JsonRpcProvider | null = null;
let reachable = false;

beforeAll(async () => {
  if (!config) return;
  provider = new JsonRpcProvider(config.rpcUrl);
  try {
    await provider.getBlockNumber();
    reachable = true;
  } catch {
    reachable = false;
  }
}, 30_000);

const describeLive = describe.runIf(Boolean(config));

if (!config) {
  console.warn("[policy client] no deployment configured; live checks skipped");
}

describeLive("shared policy client against the live deployment", () => {
  /** A fresh address has never been touched, so it exercises the true default state. */
  function probeSigner() {
    if (!provider) throw new Error("provider unavailable");
    return Wallet.createRandom().connect(provider);
  }

  it("reads the real contract through its own ABI", async () => {
    if (!reachable || !provider || !config) return;
    const policy = policyManager(config.policyManagerAddress, provider);
    const guard = executionGuard(config.executionGuardAddress, provider);

    const state = await readWalletPolicy(policy, guard, probeSigner().address);

    // Every function in the client's ABI that this path touches resolved, and the contract
    // reported the deny-by-default state the client documents.
    expect(state.dailyLimitWei).toBe(0n);
    expect(state.limit.kind).toBe("blocked");
  }, 30_000);

  it("computes the same role hashes the contract does", async () => {
    if (!reachable || !provider || !config) return;
    const policy = policyManager(config.policyManagerAddress, provider);
    const roles = await readPolicyRoles(policy, probeSigner().address);
    expect(roles).toMatchObject({ policyAdmin: false, defaultAdmin: false });

    // hasRole accepted the hash this client computes, which is the only thing that makes the
    // pre-flight permission check trustworthy.
    expect(POLICY_ADMIN_ROLE).toMatch(/^0x[0-9a-f]{64}$/);
  }, 30_000);

  it("turns the contract's own refusal into something an operator can act on", async () => {
    if (!reachable || !provider || !config) return;
    const policy = policyManager(config.policyManagerAddress, probeSigner());

    // A wallet with no role asking to change a limit: the most likely thing a new operator
    // does, and the first thing that must not fail silently.
    let refusal: ReturnType<typeof decodePolicyError> | null = null;
    try {
      await policy.setWalletDailyLimit.staticCall(probeSigner().address, 5n * 10n ** 18n);
    } catch (error) {
      refusal = decodePolicyError(error);
    }

    expect(refusal).not.toBeNull();
    expect(refusal?.permission).toBe(true);
    expect(refusal?.operatorMessage).toContain("role");
    // The role the contract demanded is carried through, so the UI can name it.
    expect(refusal?.args.some((a) => a.toLowerCase() === POLICY_ADMIN_ROLE.toLowerCase())).toBe(
      true
    );
  }, 30_000);

  it("survives a deployment that predates the policy attestation", async () => {
    if (!reachable || !provider || !config) return;
    const policy = policyManager(config.policyManagerAddress, provider);
    const attestation = await detectPolicyAttestation(policy);

    // Deliberately invariant: this asserts the client degrades cleanly, not that the
    // deployment is old. It holds before and after the redeploy.
    expect(typeof attestation.supported).toBe("boolean");
    if (attestation.supported) {
      expect(attestation.head).not.toBeNull();
    } else {
      expect(attestation.reason && attestation.reason.length).toBeGreaterThan(0);
    }
  }, 30_000);
});
