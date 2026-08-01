import type { VercelRequest, VercelResponse } from "@vercel/node";
import { durableEnabled, persistDurable } from "./_durable";
import { hydrateStore } from "./_hydrate";
import { cors, snapshotDurable } from "./_store";

function normalizeEmail(raw: unknown) {
  if (typeof raw !== "string") return "";
  return raw.trim().toLowerCase().slice(0, 120);
}

function normalizeGuild(raw: unknown) {
  if (typeof raw !== "string") return "";
  return raw.trim().slice(0, 48);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();

  const s = await hydrateStore();

  if (req.method === "GET") {
    return res.status(200).json({ count: s.waitlist.length, durable: durableEnabled() });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const email = normalizeEmail(req.body?.email);
  const guild = normalizeGuild(req.body?.guild) || "Guild";
  if (!email || !email.includes("@") || email.length < 5) {
    return res.status(400).json({ error: "Valid email required" });
  }

  const existing = s.waitlist.find((w) => w.email === email);
  if (!existing) {
    s.waitlist.push({ email, guild, createdAt: new Date().toISOString() });
  }

  const merged = await persistDurable(snapshotDurable(s));
  s.waitlist = merged.waitlist;
  s.guilds = merged.guilds;

  return res.status(200).json({
    ok: true,
    count: s.waitlist.length,
    alreadyJoined: !!existing,
    durable: durableEnabled()
  });
}
