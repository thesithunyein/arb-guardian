import type { VercelRequest, VercelResponse } from "@vercel/node";
import { durableBackend, durableEnabled } from "../_durable";
import { hydrateStore } from "../_hydrate";
import { cors } from "../_store";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  const s = await hydrateStore();
  return res.status(200).json({
    items: s.incidents,
    persistence: { durable: durableEnabled(), backend: durableBackend() }
  });
}
