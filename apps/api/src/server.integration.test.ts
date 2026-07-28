import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./server.js";

async function withTestServer(run: (baseUrl: string) => Promise<void>) {
  const { app } = createApp();
  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Failed to start test server");
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await run(baseUrl);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("api integration", () => {
  beforeEach(() => {
    delete process.env.API_KEY;
    process.env.NODE_ENV = "test";
  });

  it("returns health", async () => {
    await withTestServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/health`);
      const body = (await res.json()) as { status: string };
      expect(res.status).toBe(200);
      expect(body.status).toBe("ok");
    });
  });

  it("returns product status", async () => {
    await withTestServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/status`);
      const body = (await res.json()) as { healthy: boolean; version: string; deployment: { source: string } };
      expect(res.status).toBe(200);
      expect(body.healthy).toBe(true);
      expect(body.version).toBe("0.1.0");
      expect(body.deployment.source).toBeTruthy();
    });
  });

  it("rejects invalid risk payload", async () => {
    await withTestServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/risk/assess`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txHash: "x" })
      });
      expect(res.status).toBe(400);
    });
  });

  it("creates incident from risky assessment", async () => {
    await withTestServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/risk/assess`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          txHash: "0xint1",
          wallet: "0xwallet",
          destination: "0xdead",
          method: "approve",
          amountWei: "1000",
          allowlisted: false,
          dailyLimitWei: "500",
          spentTodayWei: "0"
        })
      });
      const body = (await res.json()) as { assessment: { blocked: boolean }; incident: { id: string } };
      expect(res.status).toBe(200);
      expect(body.assessment.blocked).toBe(true);
      expect(body.incident.id).toBeTruthy();
    });
  });

  it("enforces API key when configured", async () => {
    process.env.API_KEY = "strong-test-api-key";
    await withTestServer(async (baseUrl) => {
      const unauthorized = await fetch(`${baseUrl}/risk/assess`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          txHash: "0xint2",
          wallet: "0xwallet",
          destination: "0xdead",
          method: "approve",
          amountWei: "1000",
          allowlisted: false,
          dailyLimitWei: "500",
          spentTodayWei: "0"
        })
      });
      expect(unauthorized.status).toBe(401);

      const authorized = await fetch(`${baseUrl}/risk/assess`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": "strong-test-api-key"
        },
        body: JSON.stringify({
          txHash: "0xint3",
          wallet: "0xwallet",
          destination: "0xdead",
          method: "approve",
          amountWei: "1000",
          allowlisted: false,
          dailyLimitWei: "500",
          spentTodayWei: "0"
        })
      });
      expect(authorized.status).toBe(200);
    });
  });

  it("applies incident action and exposes audit log", async () => {
    await withTestServer(async (baseUrl) => {
      const createRes = await fetch(`${baseUrl}/risk/assess`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          txHash: "0xint4",
          wallet: "0xwallet",
          destination: "0xdead",
          method: "approve",
          amountWei: "1000",
          allowlisted: false,
          dailyLimitWei: "500",
          spentTodayWei: "0"
        })
      });
      const created = (await createRes.json()) as { incident: { id: string } };
      const actionRes = await fetch(`${baseUrl}/incidents/${created.incident.id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mitigate", actor: "integration-tester" })
      });
      expect(actionRes.status).toBe(200);

      const auditRes = await fetch(`${baseUrl}/incidents/audit`);
      const auditBody = (await auditRes.json()) as { items: Array<{ incidentId: string; action: string }> };
      expect(auditRes.status).toBe(200);
      expect(auditBody.items.some((item) => item.incidentId === created.incident.id && item.action === "mitigate")).toBe(
        true
      );
    });
  });
});
