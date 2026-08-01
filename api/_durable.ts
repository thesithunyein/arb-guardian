/**
 * Optional durable persistence for waitlist + guilds.
 * Uses Vercel KV / Upstash REST when env is set; otherwise memory only.
 */
import type { GuildRecord } from "./_store";

type DurableBlob = {
  waitlist: Array<{ email: string; guild: string; createdAt: string }>;
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

export async function saveDurable(data: DurableBlob): Promise<boolean> {
  const kv = kvCreds();
  if (!kv) return false;
  try {
    const res = await fetch(`${kv.url}/set/${encodeURIComponent(KEY)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${kv.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(JSON.stringify(data))
    });
    return res.ok;
  } catch {
    return false;
  }
}
