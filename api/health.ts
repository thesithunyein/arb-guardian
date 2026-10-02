import type { VercelRequest, VercelResponse } from "@vercel/node";
import { durableBackend, durableEnabled, loadDurable } from "./_durable";
import { cors } from "./_store";

/**
 * Persistence is reported from a real read, not from the presence of environment variables:
 * credentials that do not work are worse than none, because every handler would silently
 * fall back to per-instance memory while the product claimed durability.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();

  const backend = durableBackend();
  const configured = durableEnabled();
  let reachable: boolean | null = null;
  if (configured) {
    const blob = await loadDurable();
    reachable = blob !== null;
  }

  return res.status(200).json({
    status: configured && reachable === false ? "degraded" : "ok",
    service: "arb-guardian-api",
    persistence: {
      durable: configured && reachable !== false,
      backend,
      reachable,
      note: configured
        ? null
        : "No KV credentials configured: incidents, assessments, audit history and KPI counters live in one serverless instance and reset on cold start."
    },
    mode: "production"
  });
}
