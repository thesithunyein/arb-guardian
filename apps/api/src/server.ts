import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { incidentActionSchema, riskAssessmentInputSchema } from "@arb-guardian/shared";
import { assessTransaction } from "./riskEngine.js";
import { createIncidentFromAssessment } from "./agentCoordinator.js";
import { recordAssessment } from "./assessmentStore.js";
import { applyIncidentAction, listIncidentAuditLog, listIncidents } from "./incidentStore.js";
import { getKpis } from "./kpi.js";
import { getEnv } from "./env.js";
import { getDeploymentStatus } from "./deploymentStatus.js";
import { resolvePolicyState } from "./policyResolver.js";
import { validateOnchain, syncBlockedEvents } from "./chainActions.js";
import { executeBoundedPlaybook } from "./playbookExecutor.js";
import { getChainConfig } from "./chainClient.js";

export function createApp() {
  const app = express();
  const env = getEnv();
  const apiKey = env.API_KEY?.trim();

  app.use(cors());
  app.use(express.json());
  app.use(helmet());
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 120,
      standardHeaders: true,
      legacyHeaders: false
    })
  );

  function requireApiKey(req: express.Request, res: express.Response, next: express.NextFunction) {
    if (!apiKey) return next();
    const headerValue = req.header("x-api-key");
    if (headerValue !== apiKey) {
      return res.status(401).json({ error: "unauthorized" });
    }
    return next();
  }

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "arb-guardian-api", persistence: "runtime-state.json" });
  });

  app.get("/status", (_req, res) => {
    const deployment = getDeploymentStatus();
    const kpis = getKpis();
    const chain = getChainConfig();
    res.json({
      service: "arb-guardian-api",
      version: "0.1.0",
      healthy: true,
      deployment,
      chainConnected: Boolean(chain),
      productReady: deployment.ready && deployment.network !== "hardhat" && deployment.network !== "local",
      kpis
    });
  });

  app.get("/policy/state", async (req, res) => {
    const wallet = String(req.query.wallet ?? "");
    const destination = String(req.query.destination ?? "");
    if (!wallet || !destination) {
      return res.status(400).json({ error: "wallet_and_destination_required" });
    }
    try {
      const state = await resolvePolicyState({ wallet, destination });
      return res.json({ wallet, destination, ...state });
    } catch (error) {
      return res.status(500).json({
        error: "policy_state_failed",
        message: error instanceof Error ? error.message : "unknown_error"
      });
    }
  });

  app.get("/incidents", (_req, res) => {
    res.json({ items: listIncidents() });
  });

  app.get("/kpi", (_req, res) => {
    res.json(getKpis());
  });

  app.post("/risk/assess", requireApiKey, async (req, res) => {
    const parsedBody = riskAssessmentInputSchema.safeParse(req.body);
    if (!parsedBody.success) {
      return res.status(400).json({ error: "invalid_request", details: parsedBody.error.flatten() });
    }
    const body = parsedBody.data;

    try {
      const policyState = await resolvePolicyState({
        wallet: body.wallet,
        destination: body.destination,
        allowlisted: body.allowlisted,
        dailyLimitWei: body.dailyLimitWei,
        spentTodayWei: body.spentTodayWei
      });

      const assessment = assessTransaction({
        txHash: body.txHash,
        wallet: body.wallet,
        destination: body.destination,
        method: body.method,
        amountWei: BigInt(body.amountWei),
        allowlisted: policyState.allowlisted,
        dailyLimitWei: BigInt(policyState.dailyLimitWei),
        spentTodayWei: BigInt(policyState.spentTodayWei)
      });

      recordAssessment(assessment);
      const incident = createIncidentFromAssessment(assessment);
      return res.json({ assessment, incident, policyState });
    } catch (error) {
      return res.status(500).json({
        error: "assessment_failed",
        message: error instanceof Error ? error.message : "unknown_error"
      });
    }
  });

  app.post("/chain/validate", requireApiKey, async (req, res) => {
    const parsedBody = riskAssessmentInputSchema.safeParse(req.body);
    if (!parsedBody.success) {
      return res.status(400).json({ error: "invalid_request", details: parsedBody.error.flatten() });
    }
    const body = parsedBody.data;
    try {
      const result = await validateOnchain({
        wallet: body.wallet,
        destination: body.destination,
        method: body.method,
        amountWei: body.amountWei,
        txHash: body.txHash
      });
      return res.json(result);
    } catch (error) {
      return res.status(500).json({
        error: "chain_validate_failed",
        message: error instanceof Error ? error.message : "unknown_error"
      });
    }
  });

  app.post("/chain/sync-events", requireApiKey, async (req, res) => {
    const sinceBlock = Number(req.body?.sinceBlock ?? 0);
    try {
      const result = await syncBlockedEvents(sinceBlock);
      return res.json(result);
    } catch (error) {
      return res.status(500).json({
        error: "chain_sync_failed",
        message: error instanceof Error ? error.message : "unknown_error"
      });
    }
  });

  app.get("/incidents/audit", (_req, res) => {
    res.json({ items: listIncidentAuditLog() });
  });

  app.post("/incidents/:incidentId/action", requireApiKey, async (req, res) => {
    const parsedAction = incidentActionSchema.safeParse(req.body);
    if (!parsedAction.success) {
      return res.status(400).json({ error: "invalid_request", details: parsedAction.error.flatten() });
    }

    const incidentId = Array.isArray(req.params.incidentId) ? req.params.incidentId[0] : req.params.incidentId;
    const updated = applyIncidentAction(incidentId, parsedAction.data.action, parsedAction.data.actor);
    if (!updated) {
      return res.status(404).json({ error: "incident_not_found" });
    }

    let playbookExecution = null;
    if (parsedAction.data.action === "mitigate") {
      playbookExecution = await executeBoundedPlaybook(updated);
    }

    return res.json({ incident: updated, playbookExecution });
  });

  return { app, env };
}

if (process.env.NODE_ENV !== "test") {
  const { app, env } = createApp();
  const port = Number(env.PORT ?? "8787");
  app.listen(port, () => {
    console.log(`arb-guardian api listening on :${port}`);
  });
}
