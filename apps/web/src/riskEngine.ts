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

/**
 * Approval-class calls grant standing spending authority over a token and are the
 * primary drain vector. Treated as critical: blocked by default for explicit review.
 * Kept in sync with apps/api/src/riskEngine.ts.
 */
const APPROVAL_SELECTORS = new Set([
  "0x095ea7b3", // approve(address,uint256)
  "0x39509351", // increaseAllowance(address,uint256)
  "0xd505accf", // permit(address,address,uint256,uint256,uint8,bytes32,bytes32)
  "0x8fcbaf0c", // permit (DAI-style)
  "0xa22cb465" // setApprovalForAll(address,bool)
]);

const APPROVAL_METHODS = new Set(["approve", "increaseallowance", "permit", "setapprovalforall"]);

export function isApprovalSurface(method: string): boolean {
  const raw = (method ?? "").trim().toLowerCase();
  if (!raw) return false;
  if (APPROVAL_SELECTORS.has(raw)) return true;
  return APPROVAL_METHODS.has(raw.split("(")[0].trim());
}

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
  policyPaused?: boolean;
}): RiskAssessment {
  const amountWei = BigInt(input.amountWei);
  const dailyLimitWei = BigInt(input.dailyLimitWei);
  const spentTodayWei = BigInt(input.spentTodayWei);
  let totalScore = 0;
  const matches: RiskMatch[] = [];

  if (input.policyPaused) {
    // The guard checks the pause before anything else and reverts, so no amount of allowlisting
    // or headroom makes a spend possible while the policy is frozen.
    totalScore += 100;
    matches.push({
      ruleId: "RULE_POLICY_PAUSED",
      reason: "The policy is frozen, so every spend is refused",
      severity: "critical",
      scoreDelta: 100
    });
  }

  if (!input.allowlisted) {
    totalScore += 60;
    matches.push({
      ruleId: "RULE_ALLOWLIST_DESTINATION",
      reason: "Destination is not in treasury allowlist",
      severity: "critical",
      scoreDelta: 60
    });
  }

  if (dailyLimitWei === 0n) {
    // Mirrors the onchain guard: an unconfigured wallet cannot spend at all.
    totalScore += 60;
    matches.push({
      ruleId: "RULE_DAILY_LIMIT_NOT_CONFIGURED",
      reason: "No daily limit is configured, so this wallet cannot spend",
      severity: "critical",
      scoreDelta: 60
    });
  } else if (spentTodayWei + amountWei > dailyLimitWei) {
    totalScore += 60;
    matches.push({
      ruleId: "RULE_DAILY_LIMIT",
      reason: "Daily wallet limit would be exceeded",
      severity: "high",
      scoreDelta: 60
    });
  }

  if (isApprovalSurface(input.method)) {
    totalScore += 60;
    matches.push({
      ruleId: "RULE_APPROVAL_SURFACE",
      reason: "Approval-class call grants standing spending authority and requires explicit review",
      severity: "critical",
      scoreDelta: 60
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
  policyPaused?: boolean;
}): { wouldRevert: boolean; reason: string } {
  if (input.policyPaused) {
    // `PolicyManagerPaused`, the error the guards actually revert with.
    return { wouldRevert: true, reason: "PolicyManagerPaused" };
  }
  if (!input.allowlisted) {
    return { wouldRevert: true, reason: "CounterpartyNotAllowlisted" };
  }
  const projected = BigInt(input.spentTodayWei) + BigInt(input.amountWei);
  const limit = BigInt(input.dailyLimitWei);
  if (limit === 0n) {
    return { wouldRevert: true, reason: "DailyLimitNotConfigured" };
  }
  if (projected > limit) {
    return { wouldRevert: true, reason: "DailyLimitExceeded" };
  }
  return { wouldRevert: false, reason: "allowed" };
}
