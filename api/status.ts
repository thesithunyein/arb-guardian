import type { VercelRequest, VercelResponse } from "@vercel/node";
import { cors, store } from "./_store";

const POLICY_MANAGER =
  process.env.VITE_POLICY_MANAGER_ADDRESS ||
  process.env.SUBMISSION_POLICY_MANAGER_ADDRESS ||
  "0x4f3dC29Ed0c8844E31fD84c3eE22C1C94158Cf76";
const EXECUTION_GUARD =
  process.env.VITE_EXECUTION_GUARD_ADDRESS ||
  process.env.SUBMISSION_EXECUTION_GUARD_ADDRESS ||
  "0x10fbe21ccb611A2aBF12a784C67278eAf6dE6124";
const SAFE_GUARD =
  process.env.VITE_SAFE_TREASURY_GUARD_ADDRESS ||
  process.env.SUBMISSION_SAFE_TREASURY_GUARD_ADDRESS ||
  "0xcba30F60BE3FB0fB0e9db0C816c4ab9Fa2f7b211";

export default function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  const ready = Boolean(POLICY_MANAGER && EXECUTION_GUARD);
  const s = store();
  return res.status(200).json({
    service: "arb-guardian-api",
    version: "0.2.0",
    healthy: true,
    chainConnected: ready,
    productReady: ready,
    deployment: {
      ready,
      network: "Arbitrum Sepolia",
      chainId: 421614,
      policyManager: POLICY_MANAGER || null,
      executionGuard: EXECUTION_GUARD || null,
      safeTreasuryGuard: SAFE_GUARD || null,
      source: ready ? "env" : "none"
    },
    kpis: {
      totalAssessments: s.assessments,
      blockedCount: s.blocked,
      blockedRate: s.assessments ? s.blocked / s.assessments : 0,
      criticalIncidentCount: s.critical
    }
  });
}
