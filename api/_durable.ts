/**
 * Durable persistence for waitlist + treasury roster (Vercel KV / Upstash REST).
 * Saves always merge with Redis so one instance cannot wipe the other collection.
 *
 * Redis holds one blob at a stable key. Records written before the repositioning used
 * `guilds` / `guild`; both are read back into the current field names below, so an old
 * blob is migrated on the next write rather than lost.
 */
import type { TreasuryRecord, WaitlistRecord } from "./_store";

export type DurableBlob = {
  waitlist: WaitlistRecord[];
  treasuries: TreasuryRecord[];
};

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

/** Map a stored blob (current or pre-rename) into today's shape. */
export function normalizeBlob(raw: unknown): DurableBlob {
  const blob = (raw ?? {}) as LegacyBlob;
  const waitlist = Array.isArray(blob.waitlist) ? blob.waitlist : [];
  const treasuries = Array.isArray(blob.treasuries)
    ? blob.treasuries
    : Array.isArray(blob.guilds)
      ? blob.guilds
      : [];
  return {
    waitlist: waitlist.map((row) => {
      const legacy = row as LegacyWaitlistRow;
      return {
        email: String(legacy.email ?? ""),
        treasury: String(legacy.treasury ?? legacy.guild ?? "Treasury"),
        createdAt: String(legacy.createdAt ?? "")
      };
    }),
    treasuries
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
    if (!body.result) return { waitlist: [], treasuries: [] };
    return normalizeBlob(JSON.parse(body.result));
  } catch {
    return null;
  }
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

export function mergeDurable(local: DurableBlob, remote: DurableBlob | null): DurableBlob {
  if (!remote) return local;
  return {
    waitlist: mergeWaitlist(remote.waitlist, local.waitlist),
    treasuries: mergeTreasuries(remote.treasuries, local.treasuries)
  };
}

/** Load Redis, merge with local snapshot, write back. Safe across serverless instances. */
export async function persistDurable(local: DurableBlob): Promise<DurableBlob> {
  const remote = await loadDurable();
  const merged = mergeDurable(local, remote);
  const kv = kvCreds();
  if (!kv) return merged;
  try {
    const res = await fetch(`${kv.url}/set/${encodeURIComponent(KEY)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${kv.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(JSON.stringify(merged))
    });
    if (!res.ok) return merged;
  } catch {
    // keep merged in-memory even if write fails
  }
  return merged;
}

/** @deprecated use persistDurable */
export async function saveDurable(data: DurableBlob): Promise<boolean> {
  await persistDurable(data);
  return true;
}
