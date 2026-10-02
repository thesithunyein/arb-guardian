/**
 * Runtime store for the serverless (Vercel) API layer.
 *
 * Process memory here lasts one instance, not one product: a cold start begins empty.
 * Everything that must survive is mirrored into the durable blob (`_durable.ts`) and every
 * handler that reads or writes records hydrates first (`_hydrate.ts`). Nothing in this file
 * assumes memory outlives the request that touched it.
 *
 * KPI counters are sharded per instance and merged by per-shard maximum, then summed. The
 * same write arriving twice can only raise a shard to its own value — never add it again —
 * so a merge can understate a concurrent increment but can never double count one.
 */

export type Incident = {
  id: string;
  title: string;
  details: string;
  wallet: string;
  severity: string;
  status: string;
  recommendedPlaybook: string;
  evidence: string[];
  createdAt: string;
  /** Set on every status change so a merge can pick the newer row for the same id. */
  updatedAt?: string;
};

export type AssessmentRecord = {
  txHash: string;
  wallet: string;
  destination: string;
  method: string;
  amountWei: string;
  totalScore: number;
  blocked: boolean;
  ruleIds: string[];
  generatedAt: string;
};

export type Audit = {
  incidentId: string;
  action: string;
  actor: string;
  createdAt: string;
};

export type TreasuryRecord = {
  name: string;
  owner: string;
  createdAt: string;
  lastActiveAt: string;
  usageCount: number;
  lastEvent: string;
};

export type WaitlistRecord = { email: string; treasury: string; createdAt: string };

export type CounterShard = { v: number; at: string };

/** Grow-only counter: `base` is the sum of retired shards, `shards` the live per-instance ones. */
export type CounterState = {
  base: number;
  shards: Record<string, CounterShard>;
  retired: string[];
};

export type Counters = {
  assessments: CounterState;
  blocked: CounterState;
  critical: CounterState;
  scoreSum: CounterState;
};

/** What actually gets written to Redis. `version: 1` blobs predate incidents/counters. */
export type DurableBlob = {
  version: 2;
  waitlist: WaitlistRecord[];
  treasuries: TreasuryRecord[];
  incidents: Incident[];
  assessments: AssessmentRecord[];
  audit: Audit[];
  counters: Counters;
};

/**
 * Bounded retention. Raw records are capped because the blob must stay well inside a single
 * Redis value; the counters above are cumulative and never lose history to these caps.
 */
export const RECORD_CAPS = { incidents: 100, assessments: 200, audit: 200 } as const;
export const MAX_COUNTER_SHARDS = 1024;

const instanceRandom = Math.random().toString(36).slice(2, 10);

/** Stable for the life of one serverless instance; keys this instance's counter shards. */
export const INSTANCE_ID = `i-${instanceRandom}${Date.now().toString(36)}`;

export function emptyCounter(): CounterState {
  return { base: 0, shards: {}, retired: [] };
}

export function emptyCounters(): Counters {
  return {
    assessments: emptyCounter(),
    blocked: emptyCounter(),
    critical: emptyCounter(),
    scoreSum: emptyCounter()
  };
}

export function emptyBlob(): DurableBlob {
  return {
    version: 2,
    waitlist: [],
    treasuries: [],
    incidents: [],
    assessments: [],
    audit: [],
    counters: emptyCounters()
  };
}

export function counterTotal(counter: CounterState | undefined): number {
  if (!counter) return 0;
  const shards = counter.shards ?? {};
  return (
    (Number(counter.base) || 0) +
    Object.values(shards).reduce((sum, shard) => sum + (Number(shard?.v) || 0), 0)
  );
}

export function bumpCounter(counter: CounterState, by = 1): void {
  if (!counter.shards) counter.shards = {};
  const now = new Date().toISOString();
  const prev = counter.shards[INSTANCE_ID];
  counter.shards[INSTANCE_ID] = { v: (prev?.v ?? 0) + by, at: now };
}

type Store = {
  assessments: AssessmentRecord[];
  incidents: Incident[];
  audit: Audit[];
  waitlist: WaitlistRecord[];
  treasuries: TreasuryRecord[];
  counters: Counters;
  durableHydrated?: boolean;
};

const g = globalThis as typeof globalThis & {
  __arbGuardianStore?: Partial<Store> & { guilds?: TreasuryRecord[] };
};

function normalizeCounter(raw: unknown): CounterState {
  if (typeof raw === "number") return { base: raw, shards: {}, retired: [] };
  if (!raw || typeof raw !== "object") return emptyCounter();
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

export function store(): Store {
  if (!g.__arbGuardianStore) g.__arbGuardianStore = {};
  const s = g.__arbGuardianStore as Store;

  if (!Array.isArray(s.assessments)) s.assessments = [];
  if (!Array.isArray(s.incidents)) s.incidents = [];
  if (!Array.isArray(s.audit)) s.audit = [];
  if (!Array.isArray(s.waitlist)) s.waitlist = [];
  if (!Array.isArray(s.treasuries)) {
    // A warm instance started before the rename still holds the old roster field.
    const legacy = (g.__arbGuardianStore as { guilds?: TreasuryRecord[] }).guilds;
    s.treasuries = Array.isArray(legacy) ? legacy : [];
  }
  s.counters = normalizeCounters(s.counters);
  return s;
}

export function cors(res: { setHeader: (k: string, v: string) => void }) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}

const assessmentKey = (r: AssessmentRecord) => `${r.txHash}:${r.generatedAt}`;
const auditKey = (e: Audit) => `${e.incidentId}|${e.action}|${e.actor}|${e.createdAt}`;

export function recordAssessment(record: AssessmentRecord): void {
  const s = store();
  s.assessments = [record, ...s.assessments.filter((r) => assessmentKey(r) !== assessmentKey(record))].slice(
    0,
    RECORD_CAPS.assessments
  );
}

export function upsertIncident(incident: Incident): Incident {
  const s = store();
  const next: Incident = { ...incident, updatedAt: incident.updatedAt || new Date().toISOString() };
  s.incidents = [next, ...s.incidents.filter((i) => i.id !== next.id)].slice(0, RECORD_CAPS.incidents);
  return next;
}

export function appendAudit(entry: Audit): void {
  const s = store();
  if (s.audit.some((e) => auditKey(e) === auditKey(entry))) return;
  s.audit = [entry, ...s.audit].slice(0, RECORD_CAPS.audit);
}

export function snapshotDurable(s: Store): DurableBlob {
  return {
    version: 2,
    waitlist: s.waitlist,
    treasuries: s.treasuries,
    incidents: s.incidents,
    assessments: s.assessments,
    audit: s.audit,
    counters: s.counters
  };
}
