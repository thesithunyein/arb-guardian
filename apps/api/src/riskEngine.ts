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
  /** When the policy is frozen the guard reverts before it reads anything else. */
  policyPaused?: boolean;
};

/**
 * Approval-class calls grant standing spending authority over a token and are the
 * primary drain vector for treasuries and delegated operators. They are treated as
 * critical: blocked by default and surfaced for explicit human review, matching the
 * deny-by-default posture of the onchain policy.
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

export function assessTransaction(tx: PendingTransaction): RiskAssessment {
  let totalScore = 0;
  const matches = [];

  if (tx.policyPaused) {
    // Without this the assessor would call a frozen policy's spend "allowed" while the guard
    // reverts it — exactly the drift this product exists to catch.
    totalScore += 100;
    matches.push({
      ruleId: "RULE_POLICY_PAUSED",
      reason: "The policy is frozen, so every spend is refused",
      severity: "critical" as const,
      scoreDelta: 100
    });
  }

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
  if (tx.dailyLimitWei === 0n) {
    // Mirrors the onchain guard: an unconfigured wallet cannot spend at all.
    totalScore += 60;
    matches.push({
      ruleId: "RULE_DAILY_LIMIT_NOT_CONFIGURED",
      reason: "No daily limit is configured, so this wallet cannot spend",
      severity: "critical" as const,
      scoreDelta: 60
    });
  } else if (projectedSpend > tx.dailyLimitWei) {
    totalScore += 60;
    matches.push({
      ruleId: "RULE_DAILY_LIMIT",
      reason: "Daily wallet limit would be exceeded",
      severity: "high" as const,
      scoreDelta: 60
    });
  }

  if (isApprovalSurface(tx.method)) {
    totalScore += 60;
    matches.push({
      ruleId: "RULE_APPROVAL_SURFACE",
      reason: "Approval-class call grants standing spending authority and requires explicit review",
      severity: "critical" as const,
      scoreDelta: 60
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
