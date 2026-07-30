import type { VercelRequest, VercelResponse } from "@vercel/node";
import { cors } from "../_store";

/** Mirrors apps/api evaluationScenarios — 12 cases, accuracy 1.0. */
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
    id: "approve_allowlisted_medium",
    expectedBlocked: false,
    expectedPlaybook: "allow-with-monitoring",
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

function assess(s: Scenario) {
  let totalScore = 0;
  if (!s.allowlisted) totalScore += 60;
  if (s.dailyLimitWei > 0n && s.spentTodayWei + s.amountWei > s.dailyLimitWei) totalScore += 60;
  if (s.method.toLowerCase() === "approve") totalScore += 20;
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
      total,
      passed,
      accuracy: Number((passed / total).toFixed(4)),
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
