import { RiskAssessment } from "@arb-guardian/shared";
import { persistRuntimeState, runtimeState } from "./dataStore.js";

export function recordAssessment(assessment: RiskAssessment): void {
  runtimeState.assessments.push(assessment);
  persistRuntimeState();
}

export function listAssessments(): RiskAssessment[] {
  return [...runtimeState.assessments];
}
