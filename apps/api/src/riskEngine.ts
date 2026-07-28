import { RiskAssessment } from "@arb-guardian/shared";

export type PendingTransaction = {
  txHash: string;
  wallet: string;
  destination: string;
  method: string;
  amountWei: bigint;
  allowlisted: boolean;
  dailyLimitWei: bigint;
  spentTodayWei: bigint;
};

export function assessTransaction(tx: PendingTransaction): RiskAssessment {
  let totalScore = 0;
  const matches = [];

  if (!tx.allowlisted) {
    totalScore += 60;
    matches.push({
      ruleId: "RULE_ALLOWLIST_DESTINATION",
      reason: "Destination is not in treasury allowlist",
      severity: "critical" as const,
      scoreDelta: 60
    });
  }

  const projectedSpend = tx.spentTodayWei + tx.amountWei;
  if (tx.dailyLimitWei > 0n && projectedSpend > tx.dailyLimitWei) {
    totalScore += 40;
    matches.push({
      ruleId: "RULE_DAILY_LIMIT",
      reason: "Daily wallet limit would be exceeded",
      severity: "high" as const,
      scoreDelta: 40
    });
  }

  if (tx.method.toLowerCase() === "approve") {
    totalScore += 20;
    matches.push({
      ruleId: "RULE_APPROVAL_SURFACE",
      reason: "Approval transactions require explicit review",
      severity: "medium" as const,
      scoreDelta: 20
    });
  }

  const blocked = totalScore >= 60;
  return {
    txHash: tx.txHash,
    wallet: tx.wallet,
    destination: tx.destination,
    method: tx.method,
    totalScore,
    blocked,
    matches,
    generatedAt: new Date().toISOString()
  };
}
