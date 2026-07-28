import { describe, expect, it } from "vitest";
import { assessTransaction } from "./riskEngine.js";

describe("riskEngine", () => {
  it("blocks non-allowlisted transactions", () => {
    const result = assessTransaction({
      txHash: "0xabc",
      wallet: "0xwallet",
      destination: "0xdead",
      method: "transfer",
      amountWei: 100n,
      allowlisted: false,
      dailyLimitWei: 1000n,
      spentTodayWei: 0n
    });
    expect(result.blocked).toBe(true);
    expect(result.totalScore).toBeGreaterThanOrEqual(60);
  });
});
