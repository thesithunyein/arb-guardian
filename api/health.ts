import type { VercelRequest, VercelResponse } from "@vercel/node";
import { cors } from "./_store";

export default function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  return res.status(200).json({
    status: "ok",
    service: "arb-guardian-api",
    persistence: "ephemeral-vercel",
    mode: "production"
  });
}
