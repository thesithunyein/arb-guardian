import { recommendPlaybook } from "./agentCoordinator.js";
import { evaluationScenarios } from "./evaluationScenarios.js";
import { assessTransaction } from "./riskEngine.js";

/**
 * Policy conformance fixtures.
 *
 * IMPORTANT: this is a regression suite, not model validation. The expected outcomes
 * are authored alongside the rules in `riskEngine.ts`, so passing checks that the
 * rule engine still matches its written specification. It does NOT measure
 * generalisation, and it must never be presented as an accuracy metric for a model.
 *
 * The metric is therefore named `conformanceRate`: the share of fixed fixtures where
 * the engine reproduces the specified decision.
 */
type EvalResult = {
  scenarioId: string;
  predictedBlocked: boolean;
  expectedBlocked: boolean;
  predictedPlaybook: string;
  expectedPlaybook: string;
  score: number;
  pass: boolean;
};

function runEvaluation(): { results: EvalResult[]; summary: Record<string, number | string> } {
  const results = evaluationScenarios.map((scenario) => {
    const assessment = assessTransaction(scenario.tx);
    const predictedPlaybook = recommendPlaybook(assessment);
    const pass =
      assessment.blocked === scenario.expectedBlocked &&
      predictedPlaybook === scenario.expectedPlaybook;

    return {
      scenarioId: scenario.id,
      predictedBlocked: assessment.blocked,
      expectedBlocked: scenario.expectedBlocked,
      predictedPlaybook,
      expectedPlaybook: scenario.expectedPlaybook,
      score: assessment.totalScore,
      pass
    };
  });

  const total = results.length;
  const passed = results.filter((r) => r.pass).length;
  const blockedPrecisionDenominator = results.filter((r) => r.predictedBlocked).length;
  const blockedPrecisionNumerator = results.filter((r) => r.predictedBlocked && r.expectedBlocked).length;
  const blockedRecallDenominator = results.filter((r) => r.expectedBlocked).length;
  const blockedRecallNumerator = results.filter((r) => r.predictedBlocked && r.expectedBlocked).length;

  return {
    results,
    summary: {
      kind: "policy-conformance-fixtures",
      note: "Fixed fixtures authored with the rules. Regression check, not model validation.",
      total,
      passed,
      conformanceRate: Number((passed / total).toFixed(4)),
      blockedPrecision:
        blockedPrecisionDenominator === 0 ? 1 : Number((blockedPrecisionNumerator / blockedPrecisionDenominator).toFixed(4)),
      blockedRecall: blockedRecallDenominator === 0 ? 1 : Number((blockedRecallNumerator / blockedRecallDenominator).toFixed(4))
    }
  };
}

const report = runEvaluation();
console.log(JSON.stringify(report, null, 2));
