import { listAssessments } from "./assessmentStore.js";
import { listIncidents } from "./incidentStore.js";

export function getKpis() {
  const assessments = listAssessments();
  const incidents = listIncidents();
  const totalAssessments = assessments.length;
  const blockedCount = assessments.filter((a) => a.blocked).length;
  const blockedRate = totalAssessments === 0 ? 0 : Number((blockedCount / totalAssessments).toFixed(4));
  const avgScore =
    totalAssessments === 0
      ? 0
      : Number((assessments.reduce((sum, a) => sum + a.totalScore, 0) / totalAssessments).toFixed(2));

  const criticalIncidents = incidents.filter((i) => i.severity === "critical").length;

  return {
    totalAssessments,
    blockedCount,
    blockedRate,
    avgScore,
    incidentCount: incidents.length,
    criticalIncidentCount: criticalIncidents
  };
}
