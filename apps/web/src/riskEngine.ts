export type RiskMatch = {
  ruleId: string;
  reason: string;
  severity: "low" | "medium" | "high" | "critical";
  scoreDelta: number;
};

export type RiskAssessment = {
  totalScore: number;
  blocked: boolean;
  matches: RiskMatch[];
  recommendedPlaybook: string;
};

export function recommendPlaybook(score: number): string {
  if (score >= 80) return "freeze-wallet-and-revoke-approvals";
  if (score >= 60) return "hold-transaction-and-require-admin-review";
  if (score >= 30) return "request-secondary-signer-confirmation";
  return "allow-with-monitoring";
}

export function assessIntent(input: {
  allowlisted: boolean;
  dailyLimitWei: string;
  spentTodayWei: string;
  amountWei: string;
  method: string;
}): RiskAssessment {
  const amountWei = BigInt(input.amountWei);
  const dailyLimitWei = BigInt(input.dailyLimitWei);
  const spentTodayWei = BigInt(input.spentTodayWei);
  let totalScore = 0;
  const matches: RiskMatch[] = [];

  if (!input.allowlisted) {
    totalScore += 60;
    matches.push({
      ruleId: "RULE_ALLOWLIST_DESTINATION",
      reason: "Destination is not in treasury allowlist",
      severity: "critical",
      scoreDelta: 60
    });
  }

  if (dailyLimitWei > 0n && spentTodayWei + amountWei > dailyLimitWei) {
    totalScore += 60;
    matches.push({
      ruleId: "RULE_DAILY_LIMIT",
      reason: "Daily wallet limit would be exceeded",
      severity: "high",
      scoreDelta: 60
    });
  }

  if (input.method.toLowerCase() === "approve") {
    totalScore += 20;
    matches.push({
      ruleId: "RULE_APPROVAL_SURFACE",
      reason: "Approval transactions require explicit review",
      severity: "medium",
      scoreDelta: 20
    });
  }

  const blocked = totalScore >= 60;
  return {
    totalScore,
    blocked,
    matches,
    recommendedPlaybook: recommendPlaybook(totalScore)
  };
}

export function predictGuardOutcome(input: {
  allowlisted: boolean;
  dailyLimitWei: string;
  spentTodayWei: string;
  amountWei: string;
}): { wouldRevert: boolean; reason: string } {
  if (!input.allowlisted) {
    return { wouldRevert: true, reason: "CounterpartyNotAllowlisted" };
  }
  const projected = BigInt(input.spentTodayWei) + BigInt(input.amountWei);
  const limit = BigInt(input.dailyLimitWei);
  if (limit > 0n && projected > limit) {
    return { wouldRevert: true, reason: "DailyLimitExceeded" };
  }
  return { wouldRevert: false, reason: "allowed" };
}
