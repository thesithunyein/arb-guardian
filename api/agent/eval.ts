import type { VercelRequest, VercelResponse } from "@vercel/node";
import { cors } from "../_store";

/**
 * Policy conformance fixtures (serverless copy).
 *
 * Kept in sync with apps/api/src/{riskEngine,evaluationScenarios}.ts. This is a
 * regression suite, NOT model validation: expected outcomes are authored alongside
 * the rules, so a pass only means the engine still matches its written specification.
 * The metric is `conformanceRate`, not an accuracy score.
 */
type Scenario = {
  id: string;
  expectedBlocked: boolean;
  expectedPlaybook: string;
  allowlisted: boolean;
  method: string;
  amountWei: bigint;
  dailyLimitWei: bigint;
  spentTodayWei: bigint;
};

const SCENARIOS: Scenario[] = [
  {
    id: "critical_non_allowlisted_approval",
    expectedBlocked: true,
    expectedPlaybook: "freeze-wallet-and-revoke-approvals",
    allowlisted: false,
    method: "approve",
    amountWei: 9_000000000000000000n,
    dailyLimitWei: 2_000000000000000000n,
    spentTodayWei: 0n
  },
  {
    id: "high_limit_exceed",
    expectedBlocked: true,
    expectedPlaybook: "hold-transaction-and-require-admin-review",
    allowlisted: true,
    method: "transfer",
    amountWei: 4_000000000000000000n,
    dailyLimitWei: 3_000000000000000000n,
    spentTodayWei: 0n
  },
  {
    id: "safe_transfer",
    expectedBlocked: false,
    expectedPlaybook: "allow-with-monitoring",
    allowlisted: true,
    method: "transfer",
    amountWei: 1_000000000000000000n,
    dailyLimitWei: 5_000000000000000000n,
    spentTodayWei: 0n
  },
  {
    id: "non_allowlisted_transfer",
    expectedBlocked: true,
    expectedPlaybook: "hold-transaction-and-require-admin-review",
    allowlisted: false,
    method: "transfer",
    amountWei: 1_000000000000000000n,
    dailyLimitWei: 5_000000000000000000n,
    spentTodayWei: 0n
  },
  {
    id: "limit_exceed_blocked",
    expectedBlocked: true,
    expectedPlaybook: "hold-transaction-and-require-admin-review",
    allowlisted: true,
    method: "transfer",
    amountWei: 2_000000000000000000n,
    dailyLimitWei: 1_000000000000000000n,
    spentTodayWei: 1_000000000000000000n
  },
  {
    // Approvals grant standing spending authority and are blocked by default.
    id: "approve_allowlisted_blocked_by_default",
    expectedBlocked: true,
    expectedPlaybook: "hold-transaction-and-require-admin-review",
    allowlisted: true,
    method: "approve",
    amountWei: 1_000000000000000000n,
    dailyLimitWei: 5_000000000000000000n,
    spentTodayWei: 0n
  },
  {
    id: "zero_risk_monitoring",
    expectedBlocked: false,
    expectedPlaybook: "allow-with-monitoring",
    allowlisted: true,
    method: "transfer",
    amountWei: 500000000000000000n,
    dailyLimitWei: 3_000000000000000000n,
    spentTodayWei: 1_000000000000000000n
  },
  {
    id: "critical_combo_approval_unlisted",
    expectedBlocked: true,
    expectedPlaybook: "freeze-wallet-and-revoke-approvals",
    allowlisted: false,
    method: "approve",
    amountWei: 5_000000000000000000n,
    dailyLimitWei: 10_000000000000000000n,
    spentTodayWei: 0n
  },
  {
    id: "high_spent_over_limit",
    expectedBlocked: true,
    expectedPlaybook: "hold-transaction-and-require-admin-review",
    allowlisted: true,
    method: "transfer",
    amountWei: 1_000000000000000000n,
    dailyLimitWei: 2_000000000000000000n,
    spentTodayWei: 1_500000000000000000n
  },
  {
    id: "blocked_unlisted_small",
    expectedBlocked: true,
    expectedPlaybook: "hold-transaction-and-require-admin-review",
    allowlisted: false,
    method: "transfer",
    amountWei: 100000000000000000n,
    dailyLimitWei: 10_000000000000000000n,
    spentTodayWei: 0n
  },
  {
    id: "safe_large_under_limit",
    expectedBlocked: false,
    expectedPlaybook: "allow-with-monitoring",
    allowlisted: true,
    method: "transfer",
    amountWei: 4_000000000000000000n,
    dailyLimitWei: 5_000000000000000000n,
    spentTodayWei: 0n
  },
  {
    // Selector-encoded increaseAllowance behaves like a named approve.
    id: "increase_allowance_selector_blocked",
    expectedBlocked: true,
    expectedPlaybook: "hold-transaction-and-require-admin-review",
    allowlisted: true,
    method: "0x39509351",
    amountWei: 1_000000000000000000n,
    dailyLimitWei: 5_000000000000000000n,
    spentTodayWei: 0n
  },
  {
    // Fail closed: no configured limit means no spending.
    id: "unconfigured_limit_blocked",
    expectedBlocked: true,
    expectedPlaybook: "hold-transaction-and-require-admin-review",
    allowlisted: true,
    method: "transfer",
    amountWei: 1_000000000000000000n,
    dailyLimitWei: 0n,
    spentTodayWei: 0n
  },
  {
    id: "critical_limit_and_unlisted",
    expectedBlocked: true,
    expectedPlaybook: "freeze-wallet-and-revoke-approvals",
    allowlisted: false,
    method: "transfer",
    amountWei: 3_000000000000000000n,
    dailyLimitWei: 1_000000000000000000n,
    spentTodayWei: 0n
  }
];

function recommendPlaybook(totalScore: number) {
  if (totalScore >= 80) return "freeze-wallet-and-revoke-approvals";
  if (totalScore >= 60) return "hold-transaction-and-require-admin-review";
  if (totalScore >= 30) return "request-secondary-signer-confirmation";
  return "allow-with-monitoring";
}

const APPROVAL_SELECTORS = new Set([
  "0x095ea7b3", // approve(address,uint256)
  "0x39509351", // increaseAllowance(address,uint256)
  "0xd505accf", // permit(...)
  "0x8fcbaf0c", // permit (DAI-style)
  "0xa22cb465" // setApprovalForAll(address,bool)
]);

const APPROVAL_METHODS = new Set(["approve", "increaseallowance", "permit", "setapprovalforall"]);

function isApprovalSurface(method: string): boolean {
  const raw = (method ?? "").trim().toLowerCase();
  if (!raw) return false;
  if (APPROVAL_SELECTORS.has(raw)) return true;
  return APPROVAL_METHODS.has(raw.split("(")[0].trim());
}

function assess(s: Scenario) {
  let totalScore = 0;
  if (!s.allowlisted) totalScore += 60;
  // Deny by default: an unconfigured wallet cannot spend.
  if (s.dailyLimitWei === 0n) totalScore += 60;
  else if (s.spentTodayWei + s.amountWei > s.dailyLimitWei) totalScore += 60;
  if (isApprovalSurface(s.method)) totalScore += 60;
  const blocked = totalScore >= 60;
  return { totalScore, blocked, playbook: recommendPlaybook(totalScore) };
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();

  const results = SCENARIOS.map((scenario) => {
    const { totalScore, blocked, playbook } = assess(scenario);
    const pass = blocked === scenario.expectedBlocked && playbook === scenario.expectedPlaybook;
    return {
      scenarioId: scenario.id,
      predictedBlocked: blocked,
      expectedBlocked: scenario.expectedBlocked,
      predictedPlaybook: playbook,
      expectedPlaybook: scenario.expectedPlaybook,
      score: totalScore,
      pass
    };
  });

  const total = results.length;
  const passed = results.filter((r) => r.pass).length;
  const blockedPrecisionDenominator = results.filter((r) => r.predictedBlocked).length;
  const blockedPrecisionNumerator = results.filter((r) => r.predictedBlocked && r.expectedBlocked).length;
  const blockedRecallDenominator = results.filter((r) => r.expectedBlocked).length;
  const blockedRecallNumerator = results.filter((r) => r.predictedBlocked && r.expectedBlocked).length;

  return res.status(200).json({
    results,
    summary: {
      kind: "policy-conformance-fixtures",
      note: "Fixed fixtures authored with the rules. Regression check, not model validation.",
      total,
      passed,
      conformanceRate: Number((passed / total).toFixed(4)),
      blockedPrecision:
        blockedPrecisionDenominator === 0
          ? 1
          : Number((blockedPrecisionNumerator / blockedPrecisionDenominator).toFixed(4)),
      blockedRecall:
        blockedRecallDenominator === 0
          ? 1
          : Number((blockedRecallNumerator / blockedRecallDenominator).toFixed(4))
    }
  });
}
