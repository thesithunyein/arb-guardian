import { describe, expect, it } from "vitest";
import { applyIncidentAction, listIncidentAuditLog, upsertIncident } from "./incidentStore.js";

describe("incidentStore", () => {
  it("applies mitigation and writes audit log", () => {
    upsertIncident({
      id: "inc-test-1",
      title: "Blocked tx",
      details: "Risk exceeded threshold",
      wallet: "0xwallet",
      severity: "high",
      status: "open",
      recommendedPlaybook: "hold-transaction-and-require-admin-review",
      evidence: ["RULE_X: sample evidence"],
      createdAt: new Date().toISOString()
    });

    const updated = applyIncidentAction("inc-test-1", "mitigate", "qa-operator");
    expect(updated?.status).toBe("mitigated");

    const logs = listIncidentAuditLog();
    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0].incidentId).toBe("inc-test-1");
    expect(logs[0].action).toBe("mitigate");
  });
});
