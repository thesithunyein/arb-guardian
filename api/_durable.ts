/**
 * Durable persistence for waitlist + guilds (Vercel KV / Upstash REST).
 * Saves always merge with Redis so one instance cannot wipe the other collection.
 */
import type { GuildRecord, WaitlistRecord } from "./_store";

export type DurableBlob = {
  waitlist: WaitlistRecord[];
  guilds: GuildRecord[];
};

const KEY = "arb-guardian:v1";

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
    if (!body.result) return { waitlist: [], guilds: [] };
    const parsed = JSON.parse(body.result) as DurableBlob;
    return {
      waitlist: Array.isArray(parsed.waitlist) ? parsed.waitlist : [],
      guilds: Array.isArray(parsed.guilds) ? parsed.guilds : []
    };
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

function mergeGuilds(a: GuildRecord[], b: GuildRecord[]) {
  const byOwner = new Map<string, GuildRecord>();
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
    guilds: mergeGuilds(remote.guilds, local.guilds)
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
