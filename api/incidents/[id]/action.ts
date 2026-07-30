import type { VercelRequest, VercelResponse } from "@vercel/node";
import { JsonRpcProvider, Wallet, Contract } from "ethers";
import { cors, store } from "../../_store";

const POLICY_ABI = ["function pause() external", "function unpause() external", "function paused() view returns (bool)"];

function trim(v?: string) {
  return (v || "").trim();
}

function getPolicy() {
  const rpc =
    trim(process.env.ARBITRUM_SEPOLIA_RPC_URL) ||
    trim(process.env.VITE_ARB_SEPOLIA_RPC_URL) ||
    "https://sepolia-rollup.arbitrum.io/rpc";
  const key = trim(process.env.OPERATOR_PRIVATE_KEY) || trim(process.env.DEPLOYER_PRIVATE_KEY);
  const policyAddress =
    trim(process.env.VITE_POLICY_MANAGER_ADDRESS) ||
    trim(process.env.SUBMISSION_POLICY_MANAGER_ADDRESS) ||
    "0x4f3dC29Ed0c8844E31fD84c3eE22C1C94158Cf76";

  if (!key) return { error: "operator_key_missing" as const };
  const provider = new JsonRpcProvider(rpc);
  const wallet = new Wallet(key, provider);
  const policy = new Contract(policyAddress, POLICY_ABI, wallet);
  return { policy, wallet };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
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
  if (action === "acknowledge" && incident.status === "open") incident.status = "acknowledged";

  s.audit.unshift({
    incidentId,
    action,
    actor,
    createdAt: new Date().toISOString()
  });

  let playbookExecution = null;
  if (action === "mitigate" && incident.recommendedPlaybook === "freeze-wallet-and-revoke-approvals") {
    const ctx = getPolicy();
    if ("error" in ctx) {
      playbookExecution = {
        playbook: incident.recommendedPlaybook,
        executed: false,
        action: "policy_manager.pause",
        txHash: null,
        error: ctx.error
      };
    } else {
      try {
        const alreadyPaused = await ctx.policy.paused();
        if (alreadyPaused) {
          playbookExecution = {
            playbook: incident.recommendedPlaybook,
            executed: true,
            action: "policy_manager.pause",
            txHash: null,
            error: null,
            note: "already_paused"
          };
        } else {
          const tx = await ctx.policy.pause();
          const receipt = await tx.wait();
          playbookExecution = {
            playbook: incident.recommendedPlaybook,
            executed: true,
            action: "policy_manager.pause",
            txHash: receipt?.hash ?? tx.hash,
            error: null
          };
        }
      } catch (err) {
        playbookExecution = {
          playbook: incident.recommendedPlaybook,
          executed: false,
          action: "policy_manager.pause",
          txHash: null,
          error: err instanceof Error ? err.message : "pause_failed"
        };
      }
    }
  } else if (action === "mitigate") {
    playbookExecution = {
      playbook: incident.recommendedPlaybook,
      executed: true,
      action: "hold_for_admin_review",
      txHash: null,
      error: null
    };
  }

  return res.status(200).json({
    incident,
    playbookExecution
  });
}
