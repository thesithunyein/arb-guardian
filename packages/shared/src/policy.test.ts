import { describe, expect, it } from "vitest";
import { keccak256, toUtf8Bytes } from "ethers";
import {
  DEFAULT_ADMIN_ROLE,
  POLICY_ADMIN_ROLE,
  UNLIMITED_LIMIT,
  canPerform,
  classifyLimit,
  decodePolicyError,
  detectPolicyAttestation,
  readTokenPolicy,
  describeLimit,
  explainMissingRole,
  parseLimitInput,
  roleForAction,
  setWalletDailyLimit,
  trimNumber
} from "./policy.js";

describe("limit semantics", () => {
  it("treats zero as blocked, not as uncapped", () => {
    // The whole point of the deny-by-default change: an unset limit must not open the lane.
    expect(classifyLimit(0n)).toBe("blocked");
    const described = describeLimit(0n, "ETH");
    expect(described.label).toBe("Blocked");
    expect(described.sentence).toContain("blocks spending");
    // Blocked is the safe state, so it must not be dressed up as a warning.
    expect(described.risk).toBe("none");
  });

  it("treats the sentinel as an explicit no-cap grant and flags it", () => {
    expect(classifyLimit(UNLIMITED_LIMIT)).toBe("unbounded");
    const described = describeLimit(UNLIMITED_LIMIT, "ETH");
    expect(described.label).toBe("No cap");
    expect(described.risk).toBe("attention");
    expect(UNLIMITED_LIMIT).toBe((1n << 256n) - 1n);
  });

  it("renders a capped limit in the asset's own units", () => {
    expect(describeLimit(5n * 10n ** 18n, "ETH").label).toBe("5 ETH / day");
    expect(describeLimit(5500n * 10n ** 6n, "USDG", 6).label).toBe("5500 USDG / day");
    expect(describeLimit(1200000000n, "USDG", 6).label).toBe("1200 USDG / day");
  });

  it("strips meaningless trailing zeros", () => {
    expect(trimNumber("5.0")).toBe("5");
    expect(trimNumber("5.5000")).toBe("5.5");
    expect(trimNumber("5")).toBe("5");
    expect(trimNumber("0.000000")).toBe("0");
  });
});

describe("parsing what a person types", () => {
  it("accepts plain and fractional amounts", () => {
    expect(parseLimitInput("0")).toEqual({ ok: true, value: 0n });
    expect(parseLimitInput("5")).toEqual({ ok: true, value: 5n * 10n ** 18n });
    expect(parseLimitInput("5.5")).toEqual({ ok: true, value: 5500000000000000000n });
    expect(parseLimitInput(" 12 ")).toEqual({ ok: true, value: 12n * 10n ** 18n });
  });

  it("accepts the words an operator would actually use for no cap", () => {
    for (const word of ["unlimited", "no cap", "max", "∞", "UNLIMITED"]) {
      expect(parseLimitInput(word)).toEqual({ ok: true, value: UNLIMITED_LIMIT });
    }
  });

  it("respects the asset's decimals", () => {
    expect(parseLimitInput("5000", 6)).toEqual({ ok: true, value: 5000000000n });
    // A wei-sized number on a 6-decimal asset would be a 1,000,000x over-grant.
    expect(parseLimitInput("1.5", 6)).toEqual({ ok: true, value: 1500000n });
    expect(parseLimitInput("0.0000001", 6)).toEqual({
      ok: false,
      error: "This asset has 6 decimal places."
    });
  });

  it("refuses input that would silently become something else", () => {
    expect(parseLimitInput("")).toMatchObject({ ok: false });
    expect(parseLimitInput("   ")).toMatchObject({ ok: false });
    expect(parseLimitInput("-1")).toMatchObject({
      ok: false,
      error: "A limit cannot be negative."
    });
    expect(parseLimitInput("1e18")).toMatchObject({ ok: false });
    expect(parseLimitInput("five")).toMatchObject({ ok: false });
    expect(parseLimitInput(".")).toMatchObject({ ok: false });
    expect(parseLimitInput("1.2345678901234567890")).toMatchObject({
      ok: false,
      error: "This asset has 18 decimal places."
    });
  });
});

describe("who may change what", () => {
  const admin = { address: "0xabc", policyAdmin: true, defaultAdmin: true };
  const policyOnly = { address: "0xabc", policyAdmin: true, defaultAdmin: false };
  const defaultOnly = { address: "0xabc", policyAdmin: false, defaultAdmin: true };
  const nobody = { address: "0xabc", policyAdmin: false, defaultAdmin: false };

  it("maps each action to the role the contract actually checks", () => {
    expect(roleForAction("setWalletDailyLimit")).toBe("policyAdmin");
    expect(roleForAction("setCounterparty")).toBe("policyAdmin");
    expect(roleForAction("setTokenDailyLimit")).toBe("policyAdmin");
    // Pause is DEFAULT_ADMIN_ROLE on PolicyManager, not POLICY_ADMIN_ROLE.
    expect(roleForAction("pause")).toBe("defaultAdmin");
    expect(roleForAction("unpause")).toBe("defaultAdmin");
  });

  it("answers before the wallet is asked to sign, so nobody pays gas to be refused", () => {
    expect(canPerform(admin, "setWalletDailyLimit")).toBe(true);
    expect(canPerform(admin, "pause")).toBe(true);
    expect(canPerform(policyOnly, "setWalletDailyLimit")).toBe(true);
    expect(canPerform(policyOnly, "pause")).toBe(false);
    expect(canPerform(defaultOnly, "setWalletDailyLimit")).toBe(false);
    expect(canPerform(defaultOnly, "pause")).toBe(true);
    expect(canPerform(nobody, "setWalletDailyLimit")).toBe(false);
  });

  it("names the missing role and where to get it", () => {
    const message = explainMissingRole("setWalletDailyLimit", "0xPOLICY");
    expect(message).toContain("POLICY_ADMIN_ROLE");
    expect(message).toContain("0xPOLICY");
    expect(explainMissingRole("pause", "0xPOLICY")).toContain("DEFAULT_ADMIN_ROLE");
  });

  it("uses the same role hashes the contract computes", () => {
    expect(POLICY_ADMIN_ROLE).toBe(keccak256(toUtf8Bytes("POLICY_ADMIN_ROLE")));
    expect(DEFAULT_ADMIN_ROLE).toBe(
      "0x0000000000000000000000000000000000000000000000000000000000000000"
    );
  });
});

describe("turning a revert into something an operator can act on", () => {
  it("recognises a missing role and marks it as a permission problem", () => {
    const decoded = decodePolicyError({
      revert: { name: "AccessControlUnauthorizedAccount", args: ["0xabc", POLICY_ADMIN_ROLE] }
    });
    expect(decoded.name).toBe("AccessControlUnauthorizedAccount");
    expect(decoded.permission).toBe(true);
    expect(decoded.operatorMessage).toContain("does not hold the role");
    expect(decoded.args).toContain(POLICY_ADMIN_ROLE);
  });

  it("explains the guard's refusals in plain terms", () => {
    expect(decodePolicyError({ revert: { name: "DailyLimitNotConfigured", args: ["0xabc"] } }).operatorMessage)
      .toContain("deny-by-default");
    expect(decodePolicyError({ revert: { name: "UnlimitedApprovalNotAllowed", args: [] } }).operatorMessage)
      .toContain("drain");
    expect(decodePolicyError({ revert: { name: "EnforcedPause", args: [] } }).operatorMessage)
      .toContain("paused");
  });

  it("distinguishes a declined wallet from a reverted call", () => {
    const declined = decodePolicyError({ code: "ACTION_REJECTED" });
    expect(declined.name).toBe("ACTION_REJECTED");
    expect(declined.permission).toBe(false);
    expect(declined.operatorMessage).toContain("declined");
  });

  it("never returns an empty message, even for reasons it does not know", () => {
    const unknown = decodePolicyError(new Error("boom"));
    expect(unknown.name).toBe("UnknownError");
    expect(unknown.operatorMessage.length).toBeGreaterThan(0);
    expect(decodePolicyError({}).operatorMessage.length).toBeGreaterThan(0);
  });
});

describe("token policy reads both contracts", () => {
  it("combines the rule from PolicyManager with the spend from ExecutionGuard", async () => {
    const policy = {
      isRegisteredToken: async () => true,
      tokenCounterpartyAllowed: async () => true,
      tokenDailyLimit: async () => 5000n * 10n ** 6n
    };
    const guard = {
      walletTokenSpentToday: async () => 1200n * 10n ** 6n
    };

    const state = await readTokenPolicy(
      policy as never,
      guard as never,
      "0xUSDG",
      "0xWALLET",
      "0xVENDOR",
      "USDG",
      6
    );

    expect(state.registered).toBe(true);
    expect(state.counterpartyAllowed).toBe(true);
    // A limit of 5,000 USDG in base units, not wei: the 6-decimal trap this lane exists for.
    expect(state.dailyLimit).toBe(5000000000n);
    expect(state.spentToday).toBe(1200000000n);
    expect(state.limit.label).toBe("5000 USDG / day");
  });
});

describe("degrading against a deployment that predates the attestation", () => {
  it("reports the deployment as unsupported instead of throwing", async () => {
    const older = {
      policySnapshot: async () => {
        throw { code: "CALL_EXCEPTION", shortMessage: "execution reverted (no data present)" };
      },
      paused: async () => false
    };
    const attestation = await detectPolicyAttestation(older as never);
    expect(attestation.supported).toBe(false);
    expect(attestation.head).toBeNull();
    expect(attestation.reason).toBeTruthy();
  });

  it("reads the head when the deployment does support it", async () => {
    const current = {
      policySnapshot: async () => [3n, "0xbeef"],
      paused: async () => true
    };
    const attestation = await detectPolicyAttestation(current as never);
    expect(attestation).toMatchObject({ supported: true });
    expect(attestation.head).toEqual({ version: 3n, digest: "0xbeef", paused: true });
  });
});

describe("write path", () => {
  it("sends, waits, then reads the policy attestation back", async () => {
    const calls: string[] = [];
    const policy = {
      setWalletDailyLimit: async (wallet: string, limit: bigint) => {
        calls.push(`set ${wallet} ${limit}`);
        return { hash: "0xtx", wait: async () => ({ hash: "0xtx", blockNumber: 42 }) };
      },
      policySnapshot: async () => {
        calls.push("snapshot");
        return [7n, "0xdigest"];
      },
      paused: async () => {
        calls.push("paused");
        return false;
      }
    };

    const change = await setWalletDailyLimit(policy as never, "0xWALLET", 5n * 10n ** 18n);

    expect(change.action).toBe("setWalletDailyLimit");
    expect(change.txHash).toBe("0xtx");
    expect(change.blockNumber).toBe(42);
    // The read-back is the point: a change that did not advance the policy is not a change.
    expect(change.head.version).toBe(7n);
    expect(change.head.digest).toBe("0xdigest");
    expect(calls).toEqual(["set 0xWALLET 5000000000000000000", "snapshot", "paused"]);
  });
});
