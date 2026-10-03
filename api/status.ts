import type { VercelRequest, VercelResponse } from "@vercel/node";
import { durableBackend, durableEnabled } from "./_durable";
import { hydrateStore } from "./_hydrate";
import { cors, counterTotal } from "./_store";

const POLICY_MANAGER = (
  process.env.VITE_POLICY_MANAGER_ADDRESS ||
  process.env.SUBMISSION_POLICY_MANAGER_ADDRESS ||
  "0x3e394b1d9781a71D71905d028C530B29Aa0021a6"
).trim();
const EXECUTION_GUARD = (
  process.env.VITE_EXECUTION_GUARD_ADDRESS ||
  process.env.SUBMISSION_EXECUTION_GUARD_ADDRESS ||
  "0x5e60F2D4E3F50eA16Ed0413e718535d720c3D5cC"
).trim();
const SAFE_GUARD = (
  process.env.VITE_SAFE_TREASURY_GUARD_ADDRESS ||
  process.env.SUBMISSION_SAFE_TREASURY_GUARD_ADDRESS ||
  "0x01b03b1e0E20F84a9Fa832AbeB58283e30cA2F1b"
).trim();
const DEPLOYMENT_STATUS = process.env.SUBMISSION_DEPLOYMENT_STATUS === "current" ? "current" : "superseded";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  const ready = DEPLOYMENT_STATUS === "current" && Boolean(POLICY_MANAGER && EXECUTION_GUARD);
  const s = await hydrateStore();
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
      source: ready ? "env" : "recorded-superseded",
      status: DEPLOYMENT_STATUS
    },
    persistence: {
      durable: durableEnabled(),
      backend: durableBackend()
    },
    kpis: {
      totalAssessments: counterTotal(s.counters.assessments),
      blockedCount: counterTotal(s.counters.blocked),
      blockedRate: (() => {
        const total = counterTotal(s.counters.assessments);
        return total ? Number((counterTotal(s.counters.blocked) / total).toFixed(4)) : 0;
      })(),
      criticalIncidentCount: counterTotal(s.counters.critical)
    }
  });
}
