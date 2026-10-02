import { describe, expect, it } from "vitest";
import { mergeCounter, mergeDurable, normalizeBlob, parseStored } from "./_durable";
import {
  appendAudit,
  counterTotal,
  MAX_COUNTER_SHARDS,
  RECORD_CAPS,
  recordAssessment,
  snapshotDurable,
  store,
  upsertIncident,
  type CounterShard,
  type CounterState,
  type Incident
} from "./_store";

const shard = (v: number, at: string): CounterShard => ({ v, at });
const counter = (shards: Record<string, CounterShard>, base = 0): CounterState => ({
  base,
  shards,
  retired: []
});

const incident = (id: string, updatedAt: string, status = "open"): Incident => ({
  id,
  title: `Incident ${id}`,
  details: "",
  wallet: "0xwallet",
  severity: "high",
  status,
  recommendedPlaybook: "hold-transaction-and-require-admin-review",
  evidence: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt
});

describe("blob shape", () => {
  it("carries every collection the product claims to persist", () => {
    recordAssessment({
      txHash: "0xtest",
      wallet: "0xwallet",
      destination: "0xpayee",
      method: "transfer",
      amountWei: "1",
      totalScore: 60,
      blocked: true,
      ruleIds: ["RULE_ALLOWLIST_DESTINATION"],
      generatedAt: "2026-01-01T00:00:00.000Z"
    });
    upsertIncident(incident("inc-shape", "2026-01-01T00:00:00.000Z"));
    appendAudit({
      incidentId: "inc-shape",
      action: "acknowledge",
      actor: "operator",
      createdAt: "2026-01-01T00:00:00.000Z"
    });

    const blob = snapshotDurable(store());
    expect(blob.version).toBe(2);
    for (const key of ["waitlist", "treasuries", "incidents", "assessments", "audit", "counters"]) {
      expect(blob).toHaveProperty(key);
    }
    expect(blob.assessments.some((a) => a.txHash === "0xtest")).toBe(true);
    expect(blob.incidents.some((i) => i.id === "inc-shape")).toBe(true);
    expect(blob.audit.some((a) => a.incidentId === "inc-shape")).toBe(true);
  });

  it("records the same assessment once when the same write arrives twice", () => {
    const record = {
      txHash: "0xdup",
      wallet: "0xwallet",
      destination: "0xpayee",
      method: "transfer",
      amountWei: "1",
      totalScore: 10,
      blocked: false,
      ruleIds: [],
      generatedAt: "2026-01-01T00:00:00.000Z"
    };
    recordAssessment(record);
    recordAssessment(record);
    expect(store().assessments.filter((a) => a.txHash === "0xdup")).toHaveLength(1);
  });
});

describe("stored encoding", () => {
  it("reads a plainly encoded value", () => {
    expect(parseStored('{"waitlist":[]}')).toEqual({ waitlist: [] });
  });

  it("reads the double-encoded value the previous writer produced", () => {
    // Live regression: a JSON string sent with a JSON content type came back quoted, so a
    // single parse yielded a string and every durable row read as absent.
    expect(parseStored(JSON.stringify(JSON.stringify({ waitlist: [] })))).toEqual({ waitlist: [] });
  });

  it("keeps a treasury row that a single parse would have hidden", () => {
    const legacy = JSON.stringify(
      JSON.stringify({
        waitlist: [],
        guilds: [
          {
            name: "Treasury",
            owner: "0xAbC",
            createdAt: "2026-01-01T00:00:00.000Z",
            lastActiveAt: "2026-01-02T00:00:00.000Z",
            usageCount: 1,
            lastEvent: "enroll"
          }
        ]
      })
    );
    const blob = normalizeBlob(parseStored(legacy));
    expect(blob.treasuries).toHaveLength(1);
    expect(blob.treasuries[0].owner).toBe("0xAbC");
  });
});

describe("version 1 blobs", () => {
  it("reads the pre-incident shape without losing what it held", () => {
    const blob = normalizeBlob({
      waitlist: [{ email: "a@b.co", guild: "Old Name", createdAt: "2026-01-01T00:00:00.000Z" }],
      guilds: [
        {
          name: "Treasury",
          owner: "0xAbC",
          createdAt: "2026-01-01T00:00:00.000Z",
          lastActiveAt: "2026-01-02T00:00:00.000Z",
          usageCount: 2,
          lastEvent: "review"
        }
      ]
    });
    expect(blob.version).toBe(2);
    expect(blob.waitlist[0].treasury).toBe("Old Name");
    expect(blob.treasuries).toHaveLength(1);
    expect(blob.incidents).toEqual([]);
    expect(blob.assessments).toEqual([]);
    expect(blob.audit).toEqual([]);
    expect(counterTotal(blob.counters.assessments)).toBe(0);
  });

  it("merges an old blob against a new one without dropping either side", () => {
    const oldBlob = normalizeBlob({
      waitlist: [{ email: "a@b.co", treasury: "Treasury", createdAt: "2026-01-01T00:00:00.000Z" }]
    });
    const newBlob = normalizeBlob({
      version: 2,
      waitlist: [{ email: "c@d.co", treasury: "Treasury", createdAt: "2026-01-02T00:00:00.000Z" }],
      counters: { assessments: counter({ i1: shard(4, "2026-01-02T00:00:00.000Z") }) }
    });
    const merged = mergeDurable(oldBlob, newBlob);
    expect(merged.waitlist.map((w) => w.email).sort()).toEqual(["a@b.co", "c@d.co"]);
    expect(counterTotal(merged.counters.assessments)).toBe(4);
  });
});

describe("record union", () => {
  it("keeps both sides and the newer status for the same incident", () => {
    const a = normalizeBlob({ incidents: [incident("inc-1", "2026-01-01T00:00:00.000Z", "open")] });
    const b = normalizeBlob({
      incidents: [
        incident("inc-1", "2026-01-02T00:00:00.000Z", "mitigated"),
        incident("inc-2", "2026-01-01T12:00:00.000Z")
      ]
    });
    const merged = mergeDurable(a, b);
    expect(merged.incidents).toHaveLength(2);
    expect(merged.incidents.find((i) => i.id === "inc-1")?.status).toBe("mitigated");
  });

  it("never grows past the retention cap", () => {
    const many = Array.from({ length: RECORD_CAPS.incidents + 25 }, (_, i) =>
      incident(`inc-${i}`, `2026-01-01T00:${String(i % 60).padStart(2, "0")}:00.000Z`)
    );
    const merged = mergeDurable(normalizeBlob({ incidents: many }), normalizeBlob({ incidents: many }));
    expect(merged.incidents).toHaveLength(RECORD_CAPS.incidents);
  });

  it("does not duplicate the same audit action arriving from two instances", () => {
    const entry = {
      incidentId: "inc-1",
      action: "acknowledge",
      actor: "operator",
      createdAt: "2026-01-01T00:00:00.000Z"
    };
    const merged = mergeDurable(normalizeBlob({ audit: [entry] }), normalizeBlob({ audit: [entry] }));
    expect(merged.audit).toHaveLength(1);
  });
});

describe("counters", () => {
  it("sums shards from different instances", () => {
    const merged = mergeCounter(
      counter({ iA: shard(3, "2026-01-01T00:00:00.000Z") }),
      counter({ iB: shard(2, "2026-01-01T00:00:01.000Z") })
    );
    expect(counterTotal(merged)).toBe(5);
  });

  it("cannot double count when the same state is merged repeatedly", () => {
    const a = counter({ iA: shard(3, "2026-01-01T00:00:00.000Z") });
    const b = counter({ iB: shard(2, "2026-01-01T00:00:01.000Z") });
    const merged = mergeCounter(a, b);
    expect(counterTotal(mergeCounter(merged, a))).toBe(5);
    expect(counterTotal(mergeCounter(merged, b))).toBe(5);
    expect(counterTotal(mergeCounter(merged, merged))).toBe(5);
  });

  it("takes the per-shard maximum, so a retried write cannot inflate a count", () => {
    const before = counter({ iA: shard(1, "2026-01-01T00:00:00.000Z") });
    const after = counter({ iA: shard(2, "2026-01-01T00:00:05.000Z") });
    expect(counterTotal(mergeCounter(before, after))).toBe(2);
  });

  it("retires the oldest shards into the base without losing the total", () => {
    const shards: Record<string, CounterShard> = {};
    for (let i = 0; i < MAX_COUNTER_SHARDS + 10; i++) {
      shards[`i${String(i).padStart(5, "0")}`] = shard(1, `2026-01-01T00:${String(i % 60).padStart(2, "0")}:00.000Z`);
    }
    const merged = mergeCounter(counter(shards), counter({}));

    expect(Object.keys(merged.shards)).toHaveLength(MAX_COUNTER_SHARDS);
    expect(counterTotal(merged)).toBe(MAX_COUNTER_SHARDS + 10);
    // A stale instance that still holds every shard must not resurrect the retired ones.
    expect(counterTotal(mergeCounter(merged, counter(shards)))).toBe(MAX_COUNTER_SHARDS + 10);
  });
});
