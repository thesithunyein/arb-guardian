import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Incident, RiskAssessment } from "@arb-guardian/shared";

export type IncidentAuditEntry = {
  incidentId: string;
  action: "acknowledge" | "mitigate" | "ignore";
  actor: string;
  createdAt: string;
};

export type RuntimeState = {
  assessments: RiskAssessment[];
  incidents: Incident[];
  incidentAuditLog: IncidentAuditEntry[];
};

const runtimeFilePath = resolve(process.cwd(), "data", "runtime-state.json");

function ensureDataDir() {
  mkdirSync(dirname(runtimeFilePath), { recursive: true });
}

function defaultState(): RuntimeState {
  return {
    assessments: [],
    incidents: [],
    incidentAuditLog: []
  };
}

function loadFromDisk(): RuntimeState {
  try {
    ensureDataDir();
    const raw = readFileSync(runtimeFilePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<RuntimeState>;
    return {
      assessments: parsed.assessments ?? [],
      incidents: parsed.incidents ?? [],
      incidentAuditLog: parsed.incidentAuditLog ?? []
    };
  } catch {
    return defaultState();
  }
}

/** Single in-memory runtime state shared by assessment + incident stores. */
export const runtimeState: RuntimeState = loadFromDisk();

export function persistRuntimeState(): void {
  ensureDataDir();
  writeFileSync(runtimeFilePath, JSON.stringify(runtimeState, null, 2), "utf8");
}
