import { Incident } from "@arb-guardian/shared";
import { pausePolicyManager } from "./chainActions.js";

export type PlaybookExecution = {
  playbook: string;
  executed: boolean;
  action: string | null;
  txHash: string | null;
  error: string | null;
};

export async function executeBoundedPlaybook(incident: Incident): Promise<PlaybookExecution> {
  const playbook = incident.recommendedPlaybook;

  if (playbook === "freeze-wallet-and-revoke-approvals") {
    const result = await pausePolicyManager();
    return {
      playbook,
      executed: result.paused,
      action: "policy_manager.pause",
      txHash: result.txHash,
      error: result.error ?? null
    };
  }

  if (playbook === "hold-transaction-and-require-admin-review") {
    return {
      playbook,
      executed: true,
      action: "hold_for_admin_review",
      txHash: null,
      error: null
    };
  }

  return {
    playbook,
    executed: false,
    action: null,
    txHash: null,
    error: "playbook_not_automatable"
  };
}
