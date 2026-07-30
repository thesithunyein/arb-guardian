import type { VercelRequest, VercelResponse } from "@vercel/node";
import { cors, store } from "../_store";

type Match = { ruleId: string; reason: string; severity: string; scoreDelta: number };

function assess(body: {
  allowlisted?: boolean;
  dailyLimitWei?: string;
  spentTodayWei?: string;
  amountWei: string;
  method: string;
}) {
  let totalScore = 0;
  const matches: Match[] = [];
  const allowlisted = body.allowlisted !== undefined ? Boolean(body.allowlisted) : true;
  const dailyLimitWei = BigInt(body.dailyLimitWei ?? "0");
  const spentTodayWei = BigInt(body.spentTodayWei ?? "0");
  const amountWei = BigInt(body.amountWei);

  if (!allowlisted) {
    totalScore += 60;
    matches.push({
      ruleId: "RULE_ALLOWLIST_DESTINATION",
      reason: "Destination is not in treasury allowlist",
      severity: "critical",
      scoreDelta: 60
    });
  }
  if (dailyLimitWei > 0n && spentTodayWei + amountWei > dailyLimitWei) {
    totalScore += 60;
    matches.push({
      ruleId: "RULE_DAILY_LIMIT",
      reason: "Daily wallet limit would be exceeded",
      severity: "high",
      scoreDelta: 60
    });
  }
  if (String(body.method).toLowerCase() === "approve") {
    totalScore += 20;
    matches.push({
      ruleId: "RULE_APPROVAL_SURFACE",
      reason: "Approval transactions require explicit review",
      severity: "medium",
      scoreDelta: 20
    });
  }

  const blocked = totalScore >= 60;
  const recommendedPlaybook =
    totalScore >= 80
      ? "freeze-wallet-and-revoke-approvals"
      : totalScore >= 60
        ? "hold-transaction-and-require-admin-review"
        : totalScore >= 30
          ? "request-secondary-signer-confirmation"
          : "allow-with-monitoring";

  return { totalScore, blocked, matches, recommendedPlaybook };
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  const body = req.body ?? {};
  if (!body.txHash || !body.wallet || !body.destination || !body.method || !body.amountWei) {
    return res.status(400).json({ error: "invalid_request" });
  }

  const result = assess(body);
  const s = store();
  s.assessments += 1;
  s.scoreSum += result.totalScore;
  if (result.blocked) s.blocked += 1;
  if (result.blocked && result.totalScore >= 80) s.critical += 1;

  const assessment = {
    ...result,
    txHash: body.txHash,
    wallet: body.wallet,
    destination: body.destination,
    method: body.method,
    generatedAt: new Date().toISOString()
  };

  let incident = null;
  if (result.blocked) {
    incident = {
      id: `inc-${body.txHash}`,
      title: `Blocked transaction for ${String(body.wallet).slice(0, 8)}...`,
      details: `Risk score ${result.totalScore}. Action gated by policy.`,
      wallet: String(body.wallet),
      severity: result.totalScore >= 80 ? "critical" : "high",
      status: "open",
      recommendedPlaybook: result.recommendedPlaybook,
      evidence: result.matches.map((m) => `${m.ruleId}: ${m.reason}`),
      createdAt: new Date().toISOString()
    };
    s.incidents = [incident, ...s.incidents.filter((i) => i.id !== incident!.id)].slice(0, 50);
  }

  return res.status(200).json({
    assessment,
    incident,
    policyState: {
      allowlisted: body.allowlisted !== undefined ? Boolean(body.allowlisted) : true,
      dailyLimitWei: String(body.dailyLimitWei ?? "0"),
      spentTodayWei: String(body.spentTodayWei ?? "0"),
      source: "request"
    }
  });
}
