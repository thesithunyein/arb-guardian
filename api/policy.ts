import type { VercelRequest, VercelResponse } from "@vercel/node";
import { JsonRpcProvider, Wallet, Contract } from "ethers";
import { cors } from "../_store";

const POLICY_ABI = ["function pause() external", "function unpause() external", "function paused() view returns (bool)"];

function trim(v?: string) {
  return (v || "").trim();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();

  const rpc =
    trim(process.env.ARBITRUM_SEPOLIA_RPC_URL) ||
    trim(process.env.VITE_ARB_SEPOLIA_RPC_URL) ||
    "https://sepolia-rollup.arbitrum.io/rpc";
  const policyAddress =
    trim(process.env.VITE_POLICY_MANAGER_ADDRESS) ||
    trim(process.env.SUBMISSION_POLICY_MANAGER_ADDRESS) ||
    "0x4f3dC29Ed0c8844E31fD84c3eE22C1C94158Cf76";

  const provider = new JsonRpcProvider(rpc);
  const reader = new Contract(policyAddress, POLICY_ABI, provider);

  if (req.method === "GET") {
    try {
      const paused = await reader.paused();
      return res.status(200).json({ policyManager: policyAddress, paused });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : "read_failed" });
    }
  }

  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  const op = String(req.body?.op || "unpause");
  const key = trim(process.env.OPERATOR_PRIVATE_KEY) || trim(process.env.DEPLOYER_PRIVATE_KEY);
  if (!key) return res.status(503).json({ error: "operator_key_missing" });

  const wallet = new Wallet(key, provider);
  const policy = new Contract(policyAddress, POLICY_ABI, wallet);

  try {
    const tx = op === "pause" ? await policy.pause() : await policy.unpause();
    const receipt = await tx.wait();
    return res.status(200).json({
      op,
      txHash: receipt?.hash ?? tx.hash,
      paused: op === "pause"
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "tx_failed" });
  }
}
