import type { VercelRequest, VercelResponse } from "@vercel/node";
import { cors, store } from "./_store";

export default function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  const s = store();
  return res.status(200).json({
    totalAssessments: s.assessments,
    blockedCount: s.blocked,
    blockedRate: s.assessments ? Number((s.blocked / s.assessments).toFixed(4)) : 0,
    avgScore: s.assessments ? Number((s.scoreSum / s.assessments).toFixed(2)) : 0,
    incidentCount: s.incidents.length,
    criticalIncidentCount: s.critical
  });
}
