import { durableEnabled, loadDurable, mergeCounter } from "./_durable";
import { RECORD_CAPS, store, type AssessmentRecord, type Audit, type Incident } from "./_store";

/**
 * Refresh memory from Redis before any read or write, so a cold instance answers with the
 * durable state instead of its own empty one — and a write merges against the blob rather
 * than replacing it. Without KV credentials this is a no-op and the store is per instance.
 */
export async function hydrateStore() {
  const s = store();
  if (!durableEnabled()) return s;

  const data = await loadDurable();
  if (!data) {
    s.durableHydrated = true;
    return s;
  }

  // Union merge into memory — never shrink Redis-backed lists from an empty instance.
  const emails = new Set(s.waitlist.map((w) => w.email.toLowerCase()));
  for (const row of data.waitlist) {
    if (!emails.has(row.email.toLowerCase())) s.waitlist.push(row);
  }

  const owners = new Map(s.treasuries.map((t) => [t.owner.toLowerCase(), t]));
  for (const row of data.treasuries) {
    const key = row.owner.toLowerCase();
    const prev = owners.get(key);
    if (!prev) {
      s.treasuries.push(row);
      owners.set(key, row);
    } else {
      prev.usageCount = Math.max(prev.usageCount, row.usageCount);
      if (row.lastActiveAt > prev.lastActiveAt) {
        prev.lastActiveAt = row.lastActiveAt;
        prev.name = row.name || prev.name;
        prev.lastEvent = row.lastEvent || prev.lastEvent;
      }
    }
  }

  const incidentStamp = (i: Incident) => i.updatedAt || i.createdAt || "";
  const byIncident = new Map(s.incidents.map((i) => [i.id, i]));
  for (const row of data.incidents) {
    const prev = byIncident.get(row.id);
    if (!prev || incidentStamp(row) >= incidentStamp(prev)) byIncident.set(row.id, row);
  }
  s.incidents = Array.from(byIncident.values())
    .sort((a, b) => (incidentStamp(a) < incidentStamp(b) ? 1 : -1))
    .slice(0, RECORD_CAPS.incidents);

  const assessmentKey = (r: AssessmentRecord) => `${r.txHash}:${r.generatedAt}`;
  const byAssessment = new Map(s.assessments.map((r) => [assessmentKey(r), r]));
  for (const row of data.assessments) {
    const key = assessmentKey(row);
    if (!byAssessment.has(key)) byAssessment.set(key, row);
  }
  s.assessments = Array.from(byAssessment.values())
    .sort((a, b) => (a.generatedAt < b.generatedAt ? 1 : -1))
    .slice(0, RECORD_CAPS.assessments);

  const auditKey = (e: Audit) => `${e.incidentId}|${e.action}|${e.actor}|${e.createdAt}`;
  const byAudit = new Map(s.audit.map((e) => [auditKey(e), e]));
  for (const row of data.audit) {
    const key = auditKey(row);
    if (!byAudit.has(key)) byAudit.set(key, row);
  }
  s.audit = Array.from(byAudit.values())
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, RECORD_CAPS.audit);

  // Counter shards merge by maximum per shard, so this is idempotent: hydrating twice, or
  // hydrating after a write that already persisted, cannot inflate a count.
  s.counters = {
    assessments: mergeCounter(data.counters.assessments, s.counters.assessments),
    blocked: mergeCounter(data.counters.blocked, s.counters.blocked),
    critical: mergeCounter(data.counters.critical, s.counters.critical),
    scoreSum: mergeCounter(data.counters.scoreSum, s.counters.scoreSum)
  };

  s.durableHydrated = true;
  return s;
}
