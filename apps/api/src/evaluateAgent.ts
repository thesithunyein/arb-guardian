import { recommendPlaybook } from "./agentCoordinator.js";
import { evaluationScenarios } from "./evaluationScenarios.js";
import { assessTransaction } from "./riskEngine.js";

type EvalResult = {
  scenarioId: string;
  predictedBlocked: boolean;
  expectedBlocked: boolean;
  predictedPlaybook: string;
  expectedPlaybook: string;
  score: number;
  pass: boolean;
};

function runEvaluation(): { results: EvalResult[]; summary: Record<string, number> } {
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
      total,
      passed,
      accuracy: Number((passed / total).toFixed(4)),
      blockedPrecision:
        blockedPrecisionDenominator === 0 ? 1 : Number((blockedPrecisionNumerator / blockedPrecisionDenominator).toFixed(4)),
      blockedRecall: blockedRecallDenominator === 0 ? 1 : Number((blockedRecallNumerator / blockedRecallDenominator).toFixed(4))
    }
  };
}

const report = runEvaluation();
console.log(JSON.stringify(report, null, 2));
