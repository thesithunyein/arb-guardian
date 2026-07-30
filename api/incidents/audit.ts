import type { VercelRequest, VercelResponse } from "@vercel/node";
import { cors, store } from "../_store";

export default function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  return res.status(200).json({ items: store().audit });
}
