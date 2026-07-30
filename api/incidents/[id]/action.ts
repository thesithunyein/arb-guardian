import type { VercelRequest, VercelResponse } from "@vercel/node";
import { cors, store } from "../../_store";

export default function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  const incidentId = String(req.query.id || "");
  const action = String(req.body?.action || "");
  const actor = String(req.body?.actor || "operator");
  if (!["acknowledge", "mitigate", "ignore"].includes(action)) {
    return res.status(400).json({ error: "invalid_action" });
  }

  const s = store();
  const incident = s.incidents.find((i) => i.id === incidentId);
  if (!incident) return res.status(404).json({ error: "incident_not_found" });

  if (action === "mitigate") incident.status = "mitigated";
  if (action === "ignore") incident.status = "ignored";

  s.audit.unshift({
    incidentId,
    action,
    actor,
    createdAt: new Date().toISOString()
  });

  return res.status(200).json({
    incident,
    playbookExecution:
      action === "mitigate" && incident.recommendedPlaybook === "freeze-wallet-and-revoke-approvals"
        ? {
            playbook: incident.recommendedPlaybook,
            executed: false,
            action: "policy_manager.pause",
            txHash: null,
            error: "operator_key_required_on_server"
          }
        : null
  });
}
