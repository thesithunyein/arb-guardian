import { useMemo, useState } from "react";

type RiskResponse = {
  assessment: {
    totalScore: number;
    blocked: boolean;
    matches: Array<{ ruleId: string; reason: string; severity: string }>;
  };
  incident: null | { id: string; title: string; recommendedPlaybook: string };
};
type KpiResponse = {
  totalAssessments: number;
  blockedCount: number;
  blockedRate: number;
  avgScore: number;
  incidentCount: number;
  criticalIncidentCount: number;
};

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";
const API_KEY = import.meta.env.VITE_API_KEY;
const CHAIN_NAME = import.meta.env.VITE_CHAIN_NAME ?? "Arbitrum Sepolia";
const POLICY_MANAGER = import.meta.env.VITE_POLICY_MANAGER_ADDRESS ?? "pending-deploy";
const EXECUTION_GUARD = import.meta.env.VITE_EXECUTION_GUARD_ADDRESS ?? "pending-deploy";

export function App() {
  const [result, setResult] = useState<RiskResponse | null>(null);
  const [incidents, setIncidents] = useState<
    Array<{ id: string; title: string; severity: string; recommendedPlaybook: string; status: string }>
  >([]);
  const [auditLog, setAuditLog] = useState<
    Array<{ incidentId: string; action: string; actor: string; createdAt: string }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [kpi, setKpi] = useState<KpiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deployment, setDeployment] = useState<{
    ready: boolean;
    network: string | null;
    policyManager: string | null;
    executionGuard: string | null;
    source: string;
  } | null>(null);

  const payload = useMemo(
    () => ({
      txHash: "0xdemo-risk-001",
      wallet: "0xTreasuryWallet0001",
      destination: "0xUnlistedDestination",
      method: "approve",
      amountWei: "1000000000000000000",
      allowlisted: false,
      dailyLimitWei: "500000000000000000",
      spentTodayWei: "0"
    }),
    []
  );

  function buildHeaders(includeApiKey = false): HeadersInit {
    const headers: HeadersInit = { "Content-Type": "application/json" };
    if (includeApiKey && API_KEY) {
      headers["x-api-key"] = API_KEY;
    }
    return headers;
  }

  async function refreshStatus() {
    const res = await fetch(`${API_BASE}/status`);
    if (!res.ok) throw new Error(`Status fetch failed (${res.status})`);
    const data = (await res.json()) as {
      deployment: {
        ready: boolean;
        network: string | null;
        policyManager: string | null;
        executionGuard: string | null;
        source: string;
      };
    };
    setDeployment(data.deployment);
  }

  async function runAssessment() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/risk/assess`, {
        method: "POST",
        headers: buildHeaders(true),
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(`Risk assessment failed (${res.status})`);
      const data = (await res.json()) as RiskResponse;
      setResult(data);
      const incidentsRes = await fetch(`${API_BASE}/incidents`);
      if (!incidentsRes.ok) throw new Error(`Incidents fetch failed (${incidentsRes.status})`);
      const incidentsData = (await incidentsRes.json()) as { items: typeof incidents };
      setIncidents(incidentsData.items);
      const kpiRes = await fetch(`${API_BASE}/kpi`);
      if (!kpiRes.ok) throw new Error(`KPI fetch failed (${kpiRes.status})`);
      const kpiData = (await kpiRes.json()) as KpiResponse;
      setKpi(kpiData);
      await refreshAudit();
      await refreshStatus();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unexpected error";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  async function refreshAudit() {
    const res = await fetch(`${API_BASE}/incidents/audit`);
    if (!res.ok) throw new Error(`Audit fetch failed (${res.status})`);
    const data = (await res.json()) as { items: typeof auditLog };
    setAuditLog(data.items);
  }

  async function applyAction(incidentId: string, action: "acknowledge" | "mitigate" | "ignore") {
    setError(null);
    try {
      const actionRes = await fetch(`${API_BASE}/incidents/${incidentId}/action`, {
        method: "POST",
        headers: buildHeaders(true),
        body: JSON.stringify({ action, actor: "treasury-operator" })
      });
      if (!actionRes.ok) throw new Error(`Incident action failed (${actionRes.status})`);
      const incidentsRes = await fetch(`${API_BASE}/incidents`);
      if (!incidentsRes.ok) throw new Error(`Incidents refresh failed (${incidentsRes.status})`);
      const incidentsData = (await incidentsRes.json()) as { items: typeof incidents };
      setIncidents(incidentsData.items);
      await refreshAudit();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unexpected error";
      setError(msg);
    }
  }

  return (
    <main className="container">
      <h1>Arb Guardian Ops Dashboard</h1>
      <p>Evidence-first risk ops for treasury transactions on Arbitrum.</p>
      {error && <p style={{ color: "#ff7b72" }}>Error: {error}</p>}
      <button onClick={runAssessment} disabled={loading}>
        {loading ? "Analyzing..." : "Run Risk Assessment"}
      </button>

      <section className="card">
        <h2>Onchain Deployment</h2>
        <ul>
          <li>Network: {deployment?.network ?? CHAIN_NAME}</li>
          <li>PolicyManager: {deployment?.policyManager ?? POLICY_MANAGER}</li>
          <li>ExecutionGuard: {deployment?.executionGuard ?? EXECUTION_GUARD}</li>
          <li>Status: {deployment?.ready ? `ready (${deployment.source})` : "pending live deploy"}</li>
        </ul>
        <p className="muted">Live addresses load from API `/status` after Arbitrum deployment.</p>
      </section>

      <section className="card">
        <h2>PMF KPI Evidence</h2>
        {kpi ? (
          <ul>
            <li>Total assessments: {kpi.totalAssessments}</li>
            <li>Blocked transactions: {kpi.blockedCount}</li>
            <li>Blocked rate: {(kpi.blockedRate * 100).toFixed(2)}%</li>
            <li>Average risk score: {kpi.avgScore}</li>
            <li>Critical incidents: {kpi.criticalIncidentCount}</li>
          </ul>
        ) : (
          <p>Run an assessment to populate KPI evidence.</p>
        )}
      </section>

      <section className="card">
        <h2>Policies</h2>
        <ul>
          <li>Counterparty allowlist is mandatory for all outgoing treasury transactions</li>
          <li>Wallet daily transfer limit: 0.5 ETH equivalent</li>
          <li>Approval actions require secondary signer confirmation</li>
        </ul>
      </section>

      {result && (
        <section className="card">
          <h2>Wallet Risk</h2>
          <p>Score: {result.assessment.totalScore}</p>
          <p>Status: {result.assessment.blocked ? "Blocked" : "Allowed"}</p>
          <ul>
            {result.assessment.matches.map((m) => (
              <li key={m.ruleId}>
                {m.ruleId}: {m.reason} ({m.severity})
              </li>
            ))}
          </ul>
          {result.incident && (
            <>
              <h3>Playbook Actions</h3>
              <p>{result.incident.recommendedPlaybook}</p>
              <p>Action mode: policy-bounded execution only</p>
            </>
          )}
        </section>
      )}

      <section className="card">
        <h2>Incidents</h2>
        {incidents.length === 0 ? (
          <p>No incidents yet. Run a risk assessment to generate one.</p>
        ) : (
          <ul>
            {incidents.map((incident) => (
              <li key={incident.id}>
                {incident.title} - {incident.severity} - {incident.status} - {incident.recommendedPlaybook}
                <div>
                  <button onClick={() => applyAction(incident.id, "acknowledge")}>Acknowledge</button>{" "}
                  <button onClick={() => applyAction(incident.id, "mitigate")}>Mitigate</button>{" "}
                  <button onClick={() => applyAction(incident.id, "ignore")}>Ignore</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>Incident Audit Trail</h2>
        {auditLog.length === 0 ? (
          <p>No action logs yet.</p>
        ) : (
          <ul>
            {auditLog.map((log, idx) => (
              <li key={`${log.incidentId}-${idx}`}>
                {log.createdAt} - {log.incidentId} - {log.action} by {log.actor}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
