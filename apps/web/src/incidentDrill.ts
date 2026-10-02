/**
 * The freeze drill, as executed against the live lane rather than described.
 *
 * The freeze path was the last claim in the product with nothing behind it, so
 * `npm run drill:incident:sepolia` runs it end to end: a risky request is refused, the operator's
 * mitigate step pauses `PolicyManager` onchain, the spend that normally settles is refused while
 * frozen, the operator unpauses, and the same spend settles again. The run writes this record, and
 * the site quotes it — hashes, gas and timings included.
 *
 * The unfreeze runs from a `finally` block in the script, so a drill cannot leave the live lane
 * frozen even if a step fails.
 */
import raw from "../../../packages/contracts/evidence/incident-drill.json";

export type DrillStep = {
  step: string;
  at: string;
  txHash?: string | null;
  status?: number | null;
  gasUsed?: string | null;
  elapsedMs?: number;
  detectionMs?: number;
  timeToFreezeMs?: number;
  expected?: string;
  incidentId?: string;
  playbook?: string | null;
  policyPausedOnchain?: boolean;
};

export type IncidentDrill = {
  ranAt: string;
  network: string;
  chainId: number;
  api: string;
  policyManager: string;
  safeTreasuryGuard: string;
  safe: string;
  operator: string;
  outcome: { policyPausedOnchain: boolean; laneLeftPaused: boolean; totalMs: number };
  kpi: { before: Record<string, unknown>; after: Record<string, number> };
  steps: DrillStep[];
};

export const incidentDrill = raw as unknown as IncidentDrill;

export const drillRanAt = incidentDrill.ranAt.replace("T", " ").replace(/\.\d+Z$/, " UTC");

export const drillStep = (name: string) => incidentDrill.steps.find((step) => step.step === name) ?? null;

/** Gas is quoted on the page because a refusal that costs nothing is easier to talk about than to check. */
export const drillSeconds = (ms: number | undefined) => (ms === undefined ? null : (ms / 1000).toFixed(1));
