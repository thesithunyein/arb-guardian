import { Incident } from "@arb-guardian/shared";
import { persistRuntimeState, runtimeState } from "./dataStore.js";

export function listIncidents(): Incident[] {
  return [...runtimeState.incidents].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function upsertIncident(incident: Incident): Incident {
  const existing = runtimeState.incidents.findIndex((i) => i.id === incident.id);
  if (existing >= 0) {
    runtimeState.incidents[existing] = incident;
  } else {
    runtimeState.incidents.push(incident);
  }
  persistRuntimeState();
  return incident;
}

export function applyIncidentAction(
  incidentId: string,
  action: "acknowledge" | "mitigate" | "ignore",
  actor: string
) {
  const incident = runtimeState.incidents.find((i) => i.id === incidentId);
  if (!incident) return null;

  if (action === "mitigate") incident.status = "mitigated";
  if (action === "ignore") incident.status = "ignored";

  runtimeState.incidentAuditLog.push({
    incidentId,
    action,
    actor,
    createdAt: new Date().toISOString()
  });
  persistRuntimeState();

  return incident;
}

export function listIncidentAuditLog() {
  return [...runtimeState.incidentAuditLog].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
