import { describe, expect, it } from "vitest";
import { assessTransaction, isApprovalSurface, type PendingTransaction } from "./riskEngine.js";

function tx(overrides: Partial<PendingTransaction> = {}): PendingTransaction {
  return {
    txHash: "0xabc",
    wallet: "0xwallet",
    destination: "0xdead",
    method: "transfer",
    amountWei: 100n,
    allowlisted: true,
    dailyLimitWei: 1000n,
    spentTodayWei: 0n,
    ...overrides
  };
}

describe("riskEngine", () => {
  it("blocks non-allowlisted transactions", () => {
    const result = assessTransaction(tx({ allowlisted: false }));
    expect(result.blocked).toBe(true);
    expect(result.totalScore).toBeGreaterThanOrEqual(60);
    expect(result.matches.map((m) => m.ruleId)).toContain("RULE_ALLOWLIST_DESTINATION");
  });

  it("allows a clean allowlisted spend under the limit", () => {
    const result = assessTransaction(tx());
    expect(result.blocked).toBe(false);
    expect(result.totalScore).toBe(0);
    expect(result.matches).toHaveLength(0);
  });

  describe("approval surface", () => {
    it("recognises approval-class method names", () => {
      for (const name of ["approve", "APPROVE", "increaseAllowance", "permit", "setApprovalForAll"]) {
        expect(isApprovalSurface(name), name).toBe(true);
      }
    });

    it("recognises approval-class selectors", () => {
      for (const selector of ["0x095ea7b3", "0x39509351", "0xd505accf", "0x8fcbaf0c", "0xa22cb465"]) {
        expect(isApprovalSurface(selector), selector).toBe(true);
      }
    });

    it("ignores plain transfers and empty input", () => {
      for (const name of ["transfer", "0xa9059cbb", ""]) {
        expect(isApprovalSurface(name), name).toBe(false);
      }
    });

    it("blocks an approval on its own, even to an allowlisted destination under the limit", () => {
      const result = assessTransaction(tx({ method: "approve" }));
      expect(result.blocked).toBe(true);
      expect(result.totalScore).toBeGreaterThanOrEqual(60);
      expect(result.matches.map((m) => m.ruleId)).toContain("RULE_APPROVAL_SURFACE");
      expect(result.matches.find((m) => m.ruleId === "RULE_APPROVAL_SURFACE")?.severity).toBe("critical");
    });

    it("blocks selector-encoded increaseAllowance", () => {
      const result = assessTransaction(tx({ method: "0x39509351" }));
      expect(result.blocked).toBe(true);
    });
  });

  describe("fail-closed daily limit", () => {
    it("blocks a wallet with no limit configured", () => {
      const result = assessTransaction(tx({ dailyLimitWei: 0n }));
      expect(result.blocked).toBe(true);
      expect(result.matches.map((m) => m.ruleId)).toContain("RULE_DAILY_LIMIT_NOT_CONFIGURED");
    });

    it("blocks when the projected spend exceeds the limit", () => {
      const result = assessTransaction(tx({ dailyLimitWei: 500n, amountWei: 600n }));
      expect(result.blocked).toBe(true);
      expect(result.matches.map((m) => m.ruleId)).toContain("RULE_DAILY_LIMIT");
    });

    it("treats an explicit unlimited limit as spendable", () => {
      const result = assessTransaction(tx({ dailyLimitWei: (2n ** 256n) - 1n }));
      expect(result.blocked).toBe(false);
    });
  });
});
