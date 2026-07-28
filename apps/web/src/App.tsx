import { useEffect, useMemo, useState } from "react";

type RiskMatch = { ruleId: string; reason: string; severity: string; scoreDelta: number };
type RiskResponse = {
  assessment: {
    totalScore: number;
    blocked: boolean;
    matches: RiskMatch[];
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
type IncidentItem = {
  id: string;
  title: string;
  severity: string;
  recommendedPlaybook: string;
  status: string;
};

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";
const API_KEY = import.meta.env.VITE_API_KEY;
const CHAIN_NAME = import.meta.env.VITE_CHAIN_NAME ?? "Arbitrum Sepolia";
const POLICY_MANAGER = import.meta.env.VITE_POLICY_MANAGER_ADDRESS ?? "pending-deploy";
const EXECUTION_GUARD = import.meta.env.VITE_EXECUTION_GUARD_ADDRESS ?? "pending-deploy";

function assessLocal(input: {
  txHash: string;
  wallet: string;
  destination: string;
  method: string;
  amountWei: string;
  allowlisted: boolean;
  dailyLimitWei: string;
  spentTodayWei: string;
}): RiskResponse {
  const amountWei = BigInt(input.amountWei);
  const dailyLimitWei = BigInt(input.dailyLimitWei);
  const spentTodayWei = BigInt(input.spentTodayWei);
  let totalScore = 0;
  const matches: RiskMatch[] = [];

  if (!input.allowlisted) {
    totalScore += 60;
    matches.push({
      ruleId: "RULE_ALLOWLIST_DESTINATION",
      reason: "Destination is not in treasury allowlist",
      severity: "critical",
      scoreDelta: 60
    });
  }

  if (dailyLimitWei > 0n && spentTodayWei + amountWei > dailyLimitWei) {
    totalScore += 40;
    matches.push({
      ruleId: "RULE_DAILY_LIMIT",
      reason: "Daily wallet limit would be exceeded",
      severity: "high",
      scoreDelta: 40
    });
  }

  if (input.method.toLowerCase() === "approve") {
    totalScore += 20;
    matches.push({
      ruleId: "RULE_APPROVAL_SURFACE",
      reason: "Approval transactions require explicit review",
      severity: "medium",
      scoreDelta: 20
    });
  }

  const blocked = totalScore >= 60;
  const playbook =
    totalScore >= 80
      ? "freeze-wallet-and-revoke-approvals"
      : totalScore >= 60
        ? "hold-transaction-and-require-admin-review"
        : totalScore >= 30
          ? "request-secondary-signer-confirmation"
          : "allow-with-monitoring";

  return {
    assessment: { totalScore, blocked, matches },
    incident: blocked
      ? {
          id: `inc-${input.txHash}`,
          title: `Blocked transaction for ${input.wallet.slice(0, 8)}...`,
          recommendedPlaybook: playbook
        }
      : null
  };
}

export function App() {
  const [result, setResult] = useState<RiskResponse | null>(null);
  const [incidents, setIncidents] = useState<IncidentItem[]>([]);
  const [auditLog, setAuditLog] = useState<
    Array<{ incidentId: string; action: string; actor: string; createdAt: string }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [kpi, setKpi] = useState<KpiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"live-api" | "demo-local">("demo-local");
  const [deployment, setDeployment] = useState<{
    ready: boolean;
    network: string | null;
    policyManager: string | null;
    executionGuard: string | null;
    source: string;
  } | null>(null);

  const payload = useMemo(
    () => ({
      txHash: `0xdemo-${Date.now().toString(16)}`,
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
    if (includeApiKey && API_KEY) headers["x-api-key"] = API_KEY;
    return headers;
  }

  function upsertLocalIncident(item: IncidentItem) {
    setIncidents((prev) => {
      const next = [item, ...prev.filter((i) => i.id !== item.id)];
      return next.slice(0, 12);
    });
  }

  function updateKpisFromLocal(blocked: boolean, score: number) {
    setKpi((prev) => {
      const totalAssessments = (prev?.totalAssessments ?? 0) + 1;
      const blockedCount = (prev?.blockedCount ?? 0) + (blocked ? 1 : 0);
      const incidentCount = blocked ? (prev?.incidentCount ?? 0) + 1 : prev?.incidentCount ?? 0;
      const criticalIncidentCount =
        blocked && score >= 80 ? (prev?.criticalIncidentCount ?? 0) + 1 : prev?.criticalIncidentCount ?? 0;
      const avgScore = Number(
        ((((prev?.avgScore ?? 0) * (totalAssessments - 1)) + score) / totalAssessments).toFixed(2)
      );
      return {
        totalAssessments,
        blockedCount,
        blockedRate: Number((blockedCount / totalAssessments).toFixed(4)),
        avgScore,
        incidentCount,
        criticalIncidentCount
      };
    });
  }

  async function refreshFromApi() {
    const [incidentsRes, kpiRes, statusRes] = await Promise.all([
      fetch(`${API_BASE}/incidents`),
      fetch(`${API_BASE}/kpi`),
      fetch(`${API_BASE}/status`)
    ]);
    if (!incidentsRes.ok || !kpiRes.ok || !statusRes.ok) throw new Error("API refresh failed");
    const incidentsData = (await incidentsRes.json()) as { items: IncidentItem[] };
    const kpiData = (await kpiRes.json()) as KpiResponse;
    const statusData = (await statusRes.json()) as { deployment: NonNullable<typeof deployment> };
    setIncidents(incidentsData.items);
    setKpi(kpiData);
    setDeployment(statusData.deployment);
    const auditRes = await fetch(`${API_BASE}/incidents/audit`);
    if (auditRes.ok) {
      const auditData = (await auditRes.json()) as { items: typeof auditLog };
      setAuditLog(auditData.items);
    }
  }

  useEffect(() => {
    fetch(`${API_BASE}/health`)
      .then((res) => {
        if (!res.ok) throw new Error("offline");
        setMode("live-api");
        return refreshFromApi();
      })
      .catch(() => {
        setMode("demo-local");
        setDeployment({
          ready: false,
          network: CHAIN_NAME,
          policyManager: POLICY_MANAGER,
          executionGuard: EXECUTION_GUARD,
          source: "none"
        });
      });
  }, []);

  async function runAssessment() {
    setLoading(true);
    setError(null);
    try {
      if (mode === "live-api") {
        const res = await fetch(`${API_BASE}/risk/assess`, {
          method: "POST",
          headers: buildHeaders(true),
          body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error(`Risk assessment failed (${res.status})`);
        const data = (await res.json()) as RiskResponse;
        setResult(data);
        await refreshFromApi();
      } else {
        const data = assessLocal(payload);
        setResult(data);
        updateKpisFromLocal(data.assessment.blocked, data.assessment.totalScore);
        if (data.incident) {
          upsertLocalIncident({
            id: data.incident.id,
            title: data.incident.title,
            severity: data.assessment.totalScore >= 80 ? "critical" : "high",
            recommendedPlaybook: data.incident.recommendedPlaybook,
            status: "open"
          });
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unexpected error";
      setError(msg);
      setMode("demo-local");
      const data = assessLocal(payload);
      setResult(data);
      updateKpisFromLocal(data.assessment.blocked, data.assessment.totalScore);
      if (data.incident) {
        upsertLocalIncident({
          id: data.incident.id,
          title: data.incident.title,
          severity: data.assessment.totalScore >= 80 ? "critical" : "high",
          recommendedPlaybook: data.incident.recommendedPlaybook,
          status: "open"
        });
      }
    } finally {
      setLoading(false);
    }
  }

  async function applyAction(incidentId: string, action: "acknowledge" | "mitigate" | "ignore") {
    setError(null);
    try {
      if (mode === "live-api") {
        const actionRes = await fetch(`${API_BASE}/incidents/${incidentId}/action`, {
          method: "POST",
          headers: buildHeaders(true),
          body: JSON.stringify({ action, actor: "treasury-operator" })
        });
        if (!actionRes.ok) throw new Error(`Incident action failed (${actionRes.status})`);
        await refreshFromApi();
        return;
      }

      setIncidents((prev) =>
        prev.map((item) =>
          item.id === incidentId
            ? {
                ...item,
                status: action === "mitigate" ? "mitigated" : action === "ignore" ? "ignored" : item.status
              }
            : item
        )
      );
      setAuditLog((prev) => [
        {
          incidentId,
          action,
          actor: "treasury-operator",
          createdAt: new Date().toISOString()
        },
        ...prev
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unexpected error";
      setError(msg);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <img src="/logo.png" alt="Arb Guardian shield logo" />
          <div className="brand-copy">
            <h1>Arb Guardian</h1>
            <p>Treasury risk operations for Arbitrum</p>
          </div>
        </div>
        <span className="badge" style={{ color: "#0b3a42", background: "rgba(95,208,200,0.22)", borderColor: "rgba(20,96,107,0.2)" }}>
          {mode === "live-api" ? "Live API" : "Demo mode"}
        </span>
      </header>

      <section className="hero">
        <div className="hero-grid">
          <div>
            <div className="badge">Shielded policy enforcement</div>
            <h2>Block unsafe treasury transactions before they execute.</h2>
            <p>
              Evidence-first risk scoring, onchain policy guardrails, and policy-bounded incident playbooks —
              built for Arbitrum operators who need real control, not mock alerts.
            </p>
            <div className="cta-row">
              <button className="primary" onClick={runAssessment} disabled={loading}>
                {loading ? "Analyzing risk..." : "Run Risk Assessment"}
              </button>
              <a className="btn ghost" href="https://github.com/thesithunyein/arb-guardian" target="_blank" rel="noreferrer">
                View source
              </a>
            </div>
            {error && <p className="error" style={{ marginTop: "0.85rem" }}>Fallback active: {error}</p>}
          </div>
          <img className="hero-logo" src="/logo.png" alt="Arb Guardian brand mark" />
        </div>
      </section>

      <section className="card span-2" style={{ marginBottom: "1rem" }}>
        <h3>Guardian flow</h3>
        <div className="flow">
          <div className="flow-step">1. Policy</div>
          <div className="flow-step">2. Assess</div>
          <div className="flow-step">3. Block</div>
          <div className="flow-step">4. Incident</div>
          <div className="flow-step">5. Mitigate</div>
        </div>
      </section>

      <div className="grid">
        <section className="card">
          <h3>Onchain Deployment</h3>
          <ul>
            <li>Network: {deployment?.network ?? CHAIN_NAME}</li>
            <li>
              PolicyManager: <span className="mono">{deployment?.policyManager ?? POLICY_MANAGER}</span>
            </li>
            <li>
              ExecutionGuard: <span className="mono">{deployment?.executionGuard ?? EXECUTION_GUARD}</span>
            </li>
            <li>Status: {deployment?.ready ? `ready (${deployment.source})` : "pending live deploy"}</li>
          </ul>
        </section>

        <section className="card">
          <h3>Policies</h3>
          <ul>
            <li>Counterparty allowlist required for outbound treasury transfers</li>
            <li>Wallet daily transfer ceiling enforced onchain</li>
            <li>Approval surface requires secondary review</li>
          </ul>
        </section>

        <section className="card span-2">
          <h3>PMF KPI Evidence</h3>
          {kpi ? (
            <div className="kpi-row">
              <div className="kpi">
                <strong>{kpi.totalAssessments}</strong>
                <span>Assessments</span>
              </div>
              <div className="kpi">
                <strong>{kpi.blockedCount}</strong>
                <span>Blocked</span>
              </div>
              <div className="kpi">
                <strong>{(kpi.blockedRate * 100).toFixed(0)}%</strong>
                <span>Block rate</span>
              </div>
              <div className="kpi">
                <strong>{kpi.criticalIncidentCount}</strong>
                <span>Critical</span>
              </div>
            </div>
          ) : (
            <p className="muted">Run an assessment to populate KPI evidence.</p>
          )}
        </section>

        {result && (
          <section className="card span-2">
            <h3>Wallet Risk</h3>
            <p>
              Score: <strong>{result.assessment.totalScore}</strong>{" "}
              <span className={`status-pill ${result.assessment.blocked ? "blocked" : "allowed"}`}>
                {result.assessment.blocked ? "Blocked" : "Allowed"}
              </span>
            </p>
            <ul>
              {result.assessment.matches.map((m) => (
                <li key={m.ruleId}>
                  <strong>{m.ruleId}</strong>: {m.reason} ({m.severity})
                </li>
              ))}
            </ul>
            {result.incident && (
              <>
                <h3 style={{ marginTop: "1rem" }}>Playbook Actions</h3>
                <p className="mono">{result.incident.recommendedPlaybook}</p>
                <p className="muted">Action mode: policy-bounded execution only</p>
              </>
            )}
          </section>
        )}

        <section className="card">
          <h3>Incidents</h3>
          {incidents.length === 0 ? (
            <p className="muted">No incidents yet. Run a risk assessment to generate one.</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {incidents.map((incident) => (
                <li className="incident-item" key={incident.id}>
                  <div>
                    <strong>{incident.title}</strong>
                  </div>
                  <div className="muted">
                    {incident.severity} · {incident.status} · {incident.recommendedPlaybook}
                  </div>
                  <div className="actions">
                    <button className="secondary" onClick={() => applyAction(incident.id, "acknowledge")}>
                      Acknowledge
                    </button>
                    <button className="secondary" onClick={() => applyAction(incident.id, "mitigate")}>
                      Mitigate
                    </button>
                    <button className="secondary" onClick={() => applyAction(incident.id, "ignore")}>
                      Ignore
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <h3>Incident Audit Trail</h3>
          {auditLog.length === 0 ? (
            <p className="muted">No action logs yet.</p>
          ) : (
            <ul>
              {auditLog.slice(0, 8).map((log, idx) => (
                <li key={`${log.incidentId}-${idx}`}>
                  <span className="mono">{log.createdAt}</span> — {log.action} by {log.actor}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
