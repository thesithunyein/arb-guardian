import type { VercelRequest, VercelResponse } from "@vercel/node";
import { durableBackend, durableEnabled } from "./_durable";
import { hydrateStore } from "./_hydrate";
import { cors, counterTotal, RECORD_CAPS } from "./_store";

/**
 * Counters are cumulative and durable; the raw records behind them are capped so the blob
 * stays inside one Redis value. Both are reported, because "how many assessments have ever
 * run" and "how many can I still open" are different questions.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();

  const s = await hydrateStore();
  const totalAssessments = counterTotal(s.counters.assessments);
  const blockedCount = counterTotal(s.counters.blocked);
  const scoreSum = counterTotal(s.counters.scoreSum);

  return res.status(200).json({
    totalAssessments,
    blockedCount,
    blockedRate: totalAssessments ? Number((blockedCount / totalAssessments).toFixed(4)) : 0,
    avgScore: totalAssessments ? Number((scoreSum / totalAssessments).toFixed(2)) : 0,
    incidentCount: s.incidents.length,
    criticalIncidentCount: counterTotal(s.counters.critical),
    retained: {
      assessments: s.assessments.length,
      incidents: s.incidents.length,
      audit: s.audit.length,
      caps: RECORD_CAPS
    },
    persistence: { durable: durableEnabled(), backend: durableBackend() }
  });
}
