import { verifyMessage } from "ethers";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { cors, store, type GuildRecord } from "./_store";

function normalizeGuild(raw: unknown) {
  if (typeof raw !== "string") return "";
  return raw.trim().slice(0, 48);
}

function normalizeAddress(raw: unknown) {
  if (typeof raw !== "string") return "";
  return raw.trim();
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function publicGuild(g: GuildRecord) {
  return {
    name: g.name,
    owner: shortAddress(g.owner),
    ownerFull: g.owner,
    usageCount: g.usageCount,
    lastActiveAt: g.lastActiveAt,
    createdAt: g.createdAt
  };
}

function stats(guilds: GuildRecord[]) {
  return {
    guildCount: guilds.length,
    officerCount: guilds.length,
    totalUsage: guilds.reduce((n, g) => n + g.usageCount, 0),
    guilds: guilds
      .slice()
      .sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt))
      .slice(0, 24)
      .map(publicGuild)
  };
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();

  const s = store();

  if (req.method === "GET") {
    return res.status(200).json(stats(s.guilds));
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const op = typeof req.body?.op === "string" ? req.body.op : "enroll";

  if (op === "usage") {
    const address = normalizeAddress(req.body?.address).toLowerCase();
    const event = typeof req.body?.event === "string" ? req.body.event : "review";
    if (!address.startsWith("0x") || address.length < 42) {
      return res.status(400).json({ error: "Valid wallet required" });
    }
    const guild = s.guilds.find((g) => g.owner.toLowerCase() === address);
    if (!guild) {
      return res.status(404).json({ error: "Guild not enrolled" });
    }
    guild.usageCount += 1;
    guild.lastActiveAt = new Date().toISOString();
    if (event === "freeze") guild.lastEvent = "freeze";
    else guild.lastEvent = "review";
    return res.status(200).json({ ok: true, ...stats(s.guilds), yours: publicGuild(guild) });
  }

  const name = normalizeGuild(req.body?.name) || "Guild";
  const address = normalizeAddress(req.body?.address);
  const message = typeof req.body?.message === "string" ? req.body.message : "";
  const signature = typeof req.body?.signature === "string" ? req.body.signature : "";

  if (!address.startsWith("0x") || address.length < 42) {
    return res.status(400).json({ error: "Valid wallet required" });
  }
  if (!message.includes("Arb Guardian guild enroll") || !message.includes(address)) {
    return res.status(400).json({ error: "Invalid enroll message" });
  }
  if (!signature.startsWith("0x") || signature.length < 80) {
    return res.status(400).json({ error: "Signature required" });
  }

  let recovered: string;
  try {
    recovered = verifyMessage(message, signature);
  } catch {
    return res.status(400).json({ error: "Could not verify signature" });
  }

  if (recovered.toLowerCase() !== address.toLowerCase()) {
    return res.status(401).json({ error: "Signature does not match wallet" });
  }

  const now = new Date().toISOString();
  const existing = s.guilds.find((g) => g.owner.toLowerCase() === address.toLowerCase());
  if (existing) {
    existing.name = name;
    existing.lastActiveAt = now;
    return res.status(200).json({
      ok: true,
      alreadyEnrolled: true,
      ...stats(s.guilds),
      yours: publicGuild(existing)
    });
  }

  const record: GuildRecord = {
    name,
    owner: recovered,
    createdAt: now,
    lastActiveAt: now,
    usageCount: 0,
    lastEvent: "enroll"
  };
  s.guilds.push(record);

  return res.status(200).json({
    ok: true,
    alreadyEnrolled: false,
    ...stats(s.guilds),
    yours: publicGuild(record)
  });
}
