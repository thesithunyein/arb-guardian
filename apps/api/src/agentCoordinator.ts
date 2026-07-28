import { Incident, RiskAssessment, riskAssessmentSchema } from "@arb-guardian/shared";
import { upsertIncident } from "./incidentStore.js";

export function recommendPlaybook(assessment: RiskAssessment): string {
  if (assessment.totalScore >= 80) return "freeze-wallet-and-revoke-approvals";
  if (assessment.totalScore >= 60) return "hold-transaction-and-require-admin-review";
  if (assessment.totalScore >= 30) return "request-secondary-signer-confirmation";
  return "allow-with-monitoring";
}

export function createIncidentFromAssessment(assessment: RiskAssessment): Incident | null {
  const parsed = riskAssessmentSchema.safeParse(assessment);
  if (!parsed.success || !assessment.blocked) return null;

  const incident: Incident = {
    id: `inc-${assessment.txHash}`,
    title: `Blocked transaction for ${assessment.wallet.slice(0, 8)}...`,
    details: `Risk score ${assessment.totalScore}. Action gated by policy.`,
    wallet: assessment.wallet,
    severity: assessment.totalScore >= 80 ? "critical" : "high",
    status: "open",
    recommendedPlaybook: recommendPlaybook(assessment),
    evidence: assessment.matches.map((m) => `${m.ruleId}: ${m.reason}`),
    createdAt: new Date().toISOString()
  };

  return upsertIncident(incident);
}
