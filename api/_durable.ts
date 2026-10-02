/**
 * Durable persistence for the serverless API layer (Vercel KV / Upstash Redis REST).
 *
 * Redis holds one blob at a stable key. Blob `version: 1` held only the waitlist and treasury
 * roster; `version: 2` adds incidents, assessments, audit history and the KPI counters, and a
 * v1 blob is read back into the current shape rather than lost. Records written before the
 * repositioning used `guilds` / `guild`; both are still read.
 *
 * Merges are conflict-free in the honest direction. Lists are unioned by key with the newer
 * row winning, so an instance that never saw a record cannot erase it. Counters are sharded
 * per instance and merged by per-shard maximum, so a repeated write cannot inflate a count.
 * The one residual is a concurrent increment inside a merge window, which can understate a
 * counter but can never overstate it — an undercount is a smaller lie than a double count.
 */
import {
  emptyCounters,
  MAX_COUNTER_SHARDS,
  RECORD_CAPS,
  type AssessmentRecord,
  type Audit,
  type CounterShard,
  type CounterState,
  type Counters,
  type DurableBlob,
  type Incident,
  type TreasuryRecord,
  type WaitlistRecord
} from "./_store";

export type { DurableBlob } from "./_store";

const KEY = "arb-guardian:v1";

type LegacyWaitlistRow = Partial<WaitlistRecord> & { guild?: string };
type LegacyBlob = Partial<DurableBlob> & { guilds?: TreasuryRecord[] };

function kvCreds() {
  const url = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "").trim();
  const token = (
    process.env.KV_REST_API_TOKEN ||
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    ""
  ).trim();
  if (!url || !token) return null;
  return { url, token };
}

export function durableEnabled() {
  return !!kvCreds();
}

/** Which environment variables supply the store, for an honest `/api/health` answer. */
export function durableBackend(): string | null {
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) return "vercel-kv";
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) return "upstash-redis";
  return null;
}

function normalizeCounter(raw: unknown): CounterState {
  if (typeof raw === "number") return { base: raw, shards: {}, retired: [] };
  if (!raw || typeof raw !== "object") return { base: 0, shards: {}, retired: [] };
  const value = raw as Partial<CounterState>;
  const shards: Record<string, CounterShard> = {};
  for (const [key, shard] of Object.entries(value.shards ?? {})) {
    if (!shard || typeof shard !== "object") continue;
    shards[key] = { v: Number((shard as CounterShard).v) || 0, at: String((shard as CounterShard).at ?? "") };
  }
  return {
    base: Number(value.base) || 0,
    shards,
    retired: Array.isArray(value.retired) ? value.retired.map(String) : []
  };
}

function normalizeCounters(raw: unknown): Counters {
  const value = (raw ?? {}) as Partial<Record<keyof Counters, unknown>>;
  return {
    assessments: normalizeCounter(value.assessments),
    blocked: normalizeCounter(value.blocked),
    critical: normalizeCounter(value.critical),
    scoreSum: normalizeCounter(value.scoreSum)
  };
}

/**
 * Stored values exist in the wild both plainly encoded and double encoded: an earlier writer
 * sent a JSON string with `Content-Type: application/json`, so the store kept the string and
 * handed back a quoted copy of it. Parsing once therefore yielded a string, every reader saw
 * an empty store, and a durable row that was really there read as absent. Unwrap until it is
 * an object, bounded so a malformed value cannot loop.
 */
export function parseStored(raw: string): unknown {
  let value: unknown = JSON.parse(raw);
  for (let depth = 0; depth < 3 && typeof value === "string"; depth += 1) {
    value = JSON.parse(value);
  }
  return value;
}

/** Map a stored blob (current, or any earlier shape) into today's version. */
export function normalizeBlob(raw: unknown): DurableBlob {
  const blob = (raw ?? {}) as LegacyBlob;
  const waitlist = Array.isArray(blob.waitlist) ? blob.waitlist : [];
  const treasuries = Array.isArray(blob.treasuries)
    ? blob.treasuries
    : Array.isArray(blob.guilds)
      ? blob.guilds
      : [];
  return {
    version: 2,
    waitlist: waitlist.map((row) => {
      const legacy = row as LegacyWaitlistRow;
      return {
        email: String(legacy.email ?? ""),
        treasury: String(legacy.treasury ?? legacy.guild ?? "Treasury"),
        createdAt: String(legacy.createdAt ?? "")
      };
    }),
    treasuries,
    incidents: Array.isArray(blob.incidents) ? (blob.incidents as Incident[]) : [],
    assessments: Array.isArray(blob.assessments) ? (blob.assessments as AssessmentRecord[]) : [],
    audit: Array.isArray(blob.audit) ? (blob.audit as Audit[]) : [],
    counters: blob.counters ? normalizeCounters(blob.counters) : emptyCounters()
  };
}

function mergeWaitlist(a: WaitlistRecord[], b: WaitlistRecord[]) {
  const byEmail = new Map<string, WaitlistRecord>();
  for (const row of [...a, ...b]) {
    const key = row.email.toLowerCase();
    const prev = byEmail.get(key);
    if (!prev || row.createdAt < prev.createdAt) byEmail.set(key, row);
  }
  return Array.from(byEmail.values());
}

function mergeTreasuries(a: TreasuryRecord[], b: TreasuryRecord[]) {
  const byOwner = new Map<string, TreasuryRecord>();
  for (const row of [...a, ...b]) {
    const key = row.owner.toLowerCase();
    const prev = byOwner.get(key);
    if (!prev) {
      byOwner.set(key, row);
      continue;
    }
    const newer = row.lastActiveAt >= prev.lastActiveAt ? row : prev;
    const older = newer === row ? prev : row;
    byOwner.set(key, {
      ...newer,
      usageCount: Math.max(prev.usageCount, row.usageCount),
      createdAt: older.createdAt < newer.createdAt ? older.createdAt : newer.createdAt,
      name: newer.name || older.name
    });
  }
  return Array.from(byOwner.values());
}

const incidentStamp = (i: Incident) => i.updatedAt || i.createdAt || "";
const assessmentKey = (r: AssessmentRecord) => `${r.txHash}:${r.generatedAt}`;
const auditKey = (e: Audit) => `${e.incidentId}|${e.action}|${e.actor}|${e.createdAt}`;

/** Union by id, newest wins, newest first, capped. */
function mergeRecords<T>(a: T[], b: T[], keyOf: (row: T) => string, stampOf: (row: T) => string, cap: number): T[] {
  const byKey = new Map<string, T>();
  for (const row of [...a, ...b]) {
    const key = keyOf(row);
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, row);
      continue;
    }
    if (stampOf(row) >= stampOf(prev)) byKey.set(key, row);
  }
  return Array.from(byKey.values())
    .sort((x, y) => (stampOf(x) < stampOf(y) ? 1 : stampOf(x) > stampOf(y) ? -1 : 0))
    .slice(0, cap);
}

/**
 * Shards are merged by per-shard maximum, then summed. A shard only ever grows, so merging
 * twice cannot count a write twice. When more than `MAX_COUNTER_SHARDS` live shards exist the
 * oldest are retired into `base`; retirement is deterministic for the same shard set, and a
 * racing instance can only lose the increment it was retiring.
 */
export function mergeCounter(leftRaw: unknown, rightRaw: unknown): CounterState {
  const left = normalizeCounter(leftRaw);
  const right = normalizeCounter(rightRaw);
  const retired = new Set([...left.retired, ...right.retired]);
  const shards: Record<string, CounterShard> = {};

  for (const key of new Set([...Object.keys(left.shards), ...Object.keys(right.shards)])) {
    if (retired.has(key)) continue;
    const l = left.shards[key];
    const r = right.shards[key];
    if (l && r) {
      shards[key] = { v: Math.max(l.v, r.v), at: l.at >= r.at ? l.at : r.at };
    } else {
      const only = (l ?? r) as CounterShard;
      shards[key] = { v: only.v, at: only.at };
    }
  }

  let base = Math.max(left.base, right.base);
  const entries = Object.entries(shards);
  const excess = entries.length - MAX_COUNTER_SHARDS;
  if (excess > 0) {
    entries.sort((x, y) => (x[1].at === y[1].at ? (x[0] < y[0] ? -1 : 1) : x[1].at < y[1].at ? -1 : 1));
    const folded = entries.slice(0, excess);
    // Plus, not max: retired shards are disjoint from `base` by construction.
    base += folded.reduce((sum, [, shard]) => sum + shard.v, 0);
    for (const [key] of folded) {
      delete shards[key];
      retired.add(key);
    }
  }

  return { base, shards, retired: Array.from(retired) };
}

export function mergeCounters(a: Counters, b: Counters): Counters {
  return {
    assessments: mergeCounter(a.assessments, b.assessments),
    blocked: mergeCounter(a.blocked, b.blocked),
    critical: mergeCounter(a.critical, b.critical),
    scoreSum: mergeCounter(a.scoreSum, b.scoreSum)
  };
}

export function mergeDurable(local: DurableBlob, remote: DurableBlob | null): DurableBlob {
  if (!remote) return local;
  return {
    version: 2,
    waitlist: mergeWaitlist(remote.waitlist, local.waitlist),
    treasuries: mergeTreasuries(remote.treasuries, local.treasuries),
    incidents: mergeRecords(
      remote.incidents,
      local.incidents,
      (i) => i.id,
      incidentStamp,
      RECORD_CAPS.incidents
    ),
    assessments: mergeRecords(
      remote.assessments,
      local.assessments,
      assessmentKey,
      (r) => r.generatedAt,
      RECORD_CAPS.assessments
    ),
    audit: mergeRecords(remote.audit, local.audit, auditKey, (e) => e.createdAt, RECORD_CAPS.audit),
    counters: mergeCounters(remote.counters, local.counters)
  };
}

export async function loadDurable(): Promise<DurableBlob | null> {
  const kv = kvCreds();
  if (!kv) return null;
  try {
    const res = await fetch(`${kv.url}/get/${encodeURIComponent(KEY)}`, {
      headers: { Authorization: `Bearer ${kv.token}` },
      cache: "no-store"
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { result?: string | null };
    if (!body.result) return normalizeBlob(null);
    return normalizeBlob(parseStored(body.result));
  } catch {
    return null;
  }
}

/**
 * Write through the command form (`["SET", key, value]`), which stores the value verbatim.
 * The path form with a JSON content type is the shape that caused the double encoding above,
 * so it is only a fallback and no longer declares itself as JSON.
 */
async function writeBlob(kv: { url: string; token: string }, value: string): Promise<boolean> {
  const auth = { Authorization: `Bearer ${kv.token}` };
  try {
    const res = await fetch(kv.url, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify(["SET", KEY, value])
    });
    if (res.ok) return true;
  } catch {
    // fall through to the path form
  }
  try {
    const res = await fetch(`${kv.url}/set/${encodeURIComponent(KEY)}`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "text/plain" },
      body: value
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Load Redis, merge with the local snapshot, write the merge back. */
export async function persistDurable(local: DurableBlob): Promise<DurableBlob> {
  const remote = await loadDurable();
  const merged = mergeDurable(local, remote);
  const kv = kvCreds();
  if (!kv) return merged;
  // Keep merged in memory even when the write fails; the next write merges again.
  await writeBlob(kv, JSON.stringify(merged));
  return merged;
}

/** @deprecated use persistDurable */
export async function saveDurable(data: DurableBlob): Promise<boolean> {
  await persistDurable(data);
  return true;
}
