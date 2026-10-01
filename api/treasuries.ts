import { verifyMessage } from "ethers";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { durableEnabled, persistDurable } from "./_durable";
import { hydrateStore } from "./_hydrate";
import { cors, snapshotDurable, type TreasuryRecord } from "./_store";

/**
 * Enrollment is a signature over a fixed message. The prefix changed when the product
 * stopped calling a treasury a "guild"; both are accepted so a message signed before that
 * change still verifies.
 */
const ENROLL_MESSAGE_PREFIX = "Arb Guardian operator enroll";
const LEGACY_ENROLL_MESSAGE_PREFIX = "Arb Guardian guild enroll";

function normalizeTreasury(raw: unknown) {
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

function publicTreasury(t: TreasuryRecord) {
  return {
    name: t.name,
    owner: shortAddress(t.owner),
    ownerFull: t.owner,
    usageCount: t.usageCount,
    lastActiveAt: t.lastActiveAt,
    createdAt: t.createdAt
  };
}

function stats(treasuries: TreasuryRecord[]) {
  return {
    treasuryCount: treasuries.length,
    operatorCount: treasuries.length,
    totalUsage: treasuries.reduce((n, t) => n + t.usageCount, 0),
    durable: durableEnabled(),
    treasuries: treasuries
      .slice()
      .sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt))
      .slice(0, 24)
      .map(publicTreasury)
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();

  const s = await hydrateStore();

  if (req.method === "GET") {
    return res.status(200).json(stats(s.treasuries));
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
    const treasury = s.treasuries.find((t) => t.owner.toLowerCase() === address);
    if (!treasury) {
      return res.status(404).json({ error: "Treasury not enrolled" });
    }
    treasury.usageCount += 1;
    treasury.lastActiveAt = new Date().toISOString();
    treasury.lastEvent = event === "freeze" ? "freeze" : "review";
    const merged = await persistDurable(snapshotDurable(s));
    s.waitlist = merged.waitlist;
    s.treasuries = merged.treasuries;
    const yours = s.treasuries.find((t) => t.owner.toLowerCase() === address)!;
    return res.status(200).json({ ok: true, ...stats(s.treasuries), yours: publicTreasury(yours) });
  }

  const name = normalizeTreasury(req.body?.name) || "Treasury";
  const address = normalizeAddress(req.body?.address);
  const message = typeof req.body?.message === "string" ? req.body.message : "";
  const signature = typeof req.body?.signature === "string" ? req.body.signature : "";

  if (!address.startsWith("0x") || address.length < 42) {
    return res.status(400).json({ error: "Valid wallet required" });
  }
  const prefixOk =
    message.includes(ENROLL_MESSAGE_PREFIX) || message.includes(LEGACY_ENROLL_MESSAGE_PREFIX);
  if (!prefixOk || !message.includes(address)) {
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
  const existing = s.treasuries.find((t) => t.owner.toLowerCase() === address.toLowerCase());
  if (existing) {
    existing.name = name;
    existing.lastActiveAt = now;
  } else {
    const record: TreasuryRecord = {
      name,
      owner: recovered,
      createdAt: now,
      lastActiveAt: now,
      usageCount: 0,
      lastEvent: "enroll"
    };
    s.treasuries.push(record);
  }

  const merged = await persistDurable(snapshotDurable(s));
  s.waitlist = merged.waitlist;
  s.treasuries = merged.treasuries;
  const yours = s.treasuries.find((t) => t.owner.toLowerCase() === address.toLowerCase())!;

  return res.status(200).json({
    ok: true,
    alreadyEnrolled: !!existing,
    ...stats(s.treasuries),
    yours: publicTreasury(yours)
  });
}
