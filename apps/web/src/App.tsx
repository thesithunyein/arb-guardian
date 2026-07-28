import { useEffect, useMemo, useState } from "react";
import { useTheme } from "./useTheme";

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
type ScenarioId = "risky-approve" | "limit-breach" | "safe-transfer";
type TabId = "overview" | "assess" | "incidents" | "evidence";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";
const API_KEY = import.meta.env.VITE_API_KEY;
const CHAIN_NAME = import.meta.env.VITE_CHAIN_NAME ?? "Arbitrum Sepolia";
const POLICY_MANAGER = import.meta.env.VITE_POLICY_MANAGER_ADDRESS ?? "pending-deploy";
const EXECUTION_GUARD = import.meta.env.VITE_EXECUTION_GUARD_ADDRESS ?? "pending-deploy";

const SCENARIOS: Record<
  ScenarioId,
  {
    label: string;
    blurb: string;
    payload: {
      wallet: string;
      destination: string;
      method: string;
      amountWei: string;
      allowlisted: boolean;
      dailyLimitWei: string;
      spentTodayWei: string;
    };
  }
> = {
  "risky-approve": {
    label: "Risky approval",
    blurb: "Non-allowlisted destination + approve surface",
    payload: {
      wallet: "0xTreasuryWallet0001",
      destination: "0xUnlistedDestination",
      method: "approve",
      amountWei: "1000000000000000000",
      allowlisted: false,
      dailyLimitWei: "500000000000000000",
      spentTodayWei: "0"
    }
  },
  "limit-breach": {
    label: "Daily limit breach",
    blurb: "Allowlisted destination but over daily ceiling",
    payload: {
      wallet: "0xTreasuryWallet0002",
      destination: "0xListedVendor",
      method: "transfer",
      amountWei: "4000000000000000000",
      allowlisted: true,
      dailyLimitWei: "3000000000000000000",
      spentTodayWei: "0"
    }
  },
  "safe-transfer": {
    label: "Safe transfer",
    blurb: "Allowlisted destination within daily limit",
    payload: {
      wallet: "0xTreasuryWallet0003",
      destination: "0xPayrollVault",
      method: "transfer",
      amountWei: "1000000000000000000",
      allowlisted: true,
      dailyLimitWei: "5000000000000000000",
      spentTodayWei: "0"
    }
  }
};

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
  const { theme, toggleTheme } = useTheme();
  const [tab, setTab] = useState<TabId>("overview");
  const [scenario, setScenario] = useState<ScenarioId>("risky-approve");
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

  const payload = useMemo(() => {
    const base = SCENARIOS[scenario].payload;
    return {
      txHash: `0xdemo-${scenario}-${Date.now().toString(16)}`,
      ...base
    };
  }, [scenario]);

  function buildHeaders(includeApiKey = false): HeadersInit {
    const headers: HeadersInit = { "Content-Type": "application/json" };
    if (includeApiKey && API_KEY) headers["x-api-key"] = API_KEY;
    return headers;
  }

  function upsertLocalIncident(item: IncidentItem) {
    setIncidents((prev) => [item, ...prev.filter((i) => i.id !== item.id)].slice(0, 12));
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
    setTab("assess");
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
        if (data.incident) setTab("incidents");
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
          setTab("incidents");
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
        setTab("incidents");
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

  const openIncidents = incidents.filter((i) => i.status === "open").length;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <img src="/logo.png" alt="Arb Guardian shield logo" width={52} height={52} />
          <div className="brand-copy">
            <h1>Arb Guardian</h1>
            <p>Treasury risk operations</p>
          </div>
        </div>
        <div className="topbar-actions">
          <span className="chip">{mode === "live-api" ? "Live API" : "Demo mode"}</span>
          <button
            type="button"
            className="icon-btn"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
          >
            {theme === "light" ? "Dark" : "Light"}
          </button>
        </div>
      </header>

      <section className="hero">
        <div className="hero-grid">
          <div>
            <p className="eyebrow">Arbitrum Open House · Buildathon</p>
            <h2>Prevent treasury loss before execution.</h2>
            <p>
              Policy guardrails, deterministic risk evidence, and bounded playbooks for operators who need
              production control—not mock alerts.
            </p>
            <div className="cta-row">
              <button type="button" className="primary" onClick={runAssessment} disabled={loading}>
                {loading ? "Analyzing…" : "Run assessment"}
              </button>
              <button type="button" className="ghost" onClick={() => setTab("evidence")}>
                Judging evidence
              </button>
            </div>
            {error && <p className="error">Using local engine: {error}</p>}
          </div>
        </div>
      </section>

      <nav className="tabs" aria-label="Primary">
        {(
          [
            ["overview", "Overview"],
            ["assess", "Assess"],
            ["incidents", `Incidents${openIncidents ? ` (${openIncidents})` : ""}`],
            ["evidence", "Evidence"]
          ] as Array<[TabId, string]>
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`tab ${tab === id ? "active" : ""}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === "overview" && (
        <div className="grid">
          <section className="card span-2">
            <h3>Operations metrics</h3>
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
              <p className="muted">Run an assessment to populate live metrics.</p>
            )}
          </section>

          <section className="card">
            <h3>Onchain deployment</h3>
            <dl className="meta">
              <div>
                <dt>Network</dt>
                <dd>{deployment?.network ?? CHAIN_NAME}</dd>
              </div>
              <div>
                <dt>PolicyManager</dt>
                <dd className="mono">{deployment?.policyManager ?? POLICY_MANAGER}</dd>
              </div>
              <div>
                <dt>ExecutionGuard</dt>
                <dd className="mono">{deployment?.executionGuard ?? EXECUTION_GUARD}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{deployment?.ready ? `Ready (${deployment.source})` : "Pending Sepolia deploy"}</dd>
              </div>
            </dl>
          </section>

          <section className="card">
            <h3>Active policies</h3>
            <ul className="clean">
              <li>Outbound counterparties must be allowlisted</li>
              <li>Per-wallet daily transfer ceiling</li>
              <li>Approve surface requires secondary review</li>
            </ul>
          </section>

          <section className="card span-2">
            <h3>Control loop</h3>
            <ol className="steps">
              <li>Set policy</li>
              <li>Assess intent</li>
              <li>Block if unsafe</li>
              <li>Open incident</li>
              <li>Mitigate + audit</li>
            </ol>
          </section>
        </div>
      )}

      {tab === "assess" && (
        <div className="grid">
          <section className="card">
            <h3>Scenario</h3>
            <div className="scenario-list">
              {(Object.keys(SCENARIOS) as ScenarioId[]).map((id) => (
                <button
                  key={id}
                  type="button"
                  className={`scenario ${scenario === id ? "active" : ""}`}
                  onClick={() => setScenario(id)}
                >
                  <strong>{SCENARIOS[id].label}</strong>
                  <span>{SCENARIOS[id].blurb}</span>
                </button>
              ))}
            </div>
            <button type="button" className="primary full" onClick={runAssessment} disabled={loading}>
              {loading ? "Analyzing…" : "Assess this intent"}
            </button>
          </section>

          <section className="card">
            <h3>Intent preview</h3>
            <dl className="meta">
              <div>
                <dt>Method</dt>
                <dd className="mono">{payload.method}</dd>
              </div>
              <div>
                <dt>Wallet</dt>
                <dd className="mono">{payload.wallet}</dd>
              </div>
              <div>
                <dt>Destination</dt>
                <dd className="mono">{payload.destination}</dd>
              </div>
              <div>
                <dt>Allowlisted</dt>
                <dd>{payload.allowlisted ? "Yes" : "No"}</dd>
              </div>
            </dl>
          </section>

          <section className="card span-2">
            <h3>Risk result</h3>
            {!result ? (
              <p className="muted">No assessment yet. Choose a scenario and run it.</p>
            ) : (
              <>
                <p className="result-line">
                  Score <strong>{result.assessment.totalScore}</strong>
                  <span className={`status-pill ${result.assessment.blocked ? "blocked" : "allowed"}`}>
                    {result.assessment.blocked ? "Blocked" : "Allowed"}
                  </span>
                </p>
                <ul className="clean">
                  {result.assessment.matches.length === 0 ? (
                    <li>No rule matches — intent within policy.</li>
                  ) : (
                    result.assessment.matches.map((m) => (
                      <li key={m.ruleId}>
                        <strong>{m.ruleId}</strong> — {m.reason}{" "}
                        <span className="muted">({m.severity}, +{m.scoreDelta})</span>
                      </li>
                    ))
                  )}
                </ul>
                {result.incident && (
                  <p className="playbook">
                    Recommended playbook: <span className="mono">{result.incident.recommendedPlaybook}</span>
                  </p>
                )}
              </>
            )}
          </section>
        </div>
      )}

      {tab === "incidents" && (
        <div className="grid">
          <section className="card">
            <h3>Incident queue</h3>
            {incidents.length === 0 ? (
              <p className="muted">No incidents. Run a risky scenario to create one.</p>
            ) : (
              <ul className="incident-list">
                {incidents.map((incident) => (
                  <li key={incident.id} className="incident-item">
                    <div className="incident-head">
                      <strong>{incident.title}</strong>
                      <span className={`sev sev-${incident.severity}`}>{incident.severity}</span>
                    </div>
                    <p className="muted">
                      {incident.status} · {incident.recommendedPlaybook}
                    </p>
                    <div className="actions">
                      <button type="button" className="secondary" onClick={() => applyAction(incident.id, "acknowledge")}>
                        Acknowledge
                      </button>
                      <button type="button" className="secondary" onClick={() => applyAction(incident.id, "mitigate")}>
                        Mitigate
                      </button>
                      <button type="button" className="secondary" onClick={() => applyAction(incident.id, "ignore")}>
                        Ignore
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card">
            <h3>Audit trail</h3>
            {auditLog.length === 0 ? (
              <p className="muted">Actions appear here after mitigate / ignore / acknowledge.</p>
            ) : (
              <ul className="clean">
                {auditLog.slice(0, 10).map((log, idx) => (
                  <li key={`${log.incidentId}-${idx}`}>
                    <span className="mono">{new Date(log.createdAt).toLocaleString()}</span>
                    <br />
                    {log.action} by {log.actor}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {tab === "evidence" && (
        <div className="grid">
          <section className="card span-2">
            <h3>Judging alignment</h3>
            <div className="evidence-grid">
              <article>
                <h4>Smart contract quality</h4>
                <p>RBAC, pause, custom errors, unit tests for allowlist/limits/rollover.</p>
              </article>
              <article>
                <h4>Product-market fit</h4>
                <p>Treasury signer workflow: policy → assess → block → mitigate.</p>
              </article>
              <article>
                <h4>Innovation</h4>
                <p>Deterministic rule evidence + policy-bounded agent playbooks.</p>
              </article>
              <article>
                <h4>Real problem solving</h4>
                <p>Stops unsafe approvals/transfers before funds move.</p>
              </article>
            </div>
          </section>
          <section className="card">
            <h3>Links</h3>
            <ul className="clean">
              <li>
                <a href="https://github.com/thesithunyein/arb-guardian" target="_blank" rel="noreferrer">
                  Public repository
                </a>
              </li>
              <li>
                <a href="https://arb-guardian.vercel.app" target="_blank" rel="noreferrer">
                  Live dashboard
                </a>
              </li>
              <li>Chain: Arbitrum (Sepolia / One when funded deploy is complete)</li>
            </ul>
          </section>
          <section className="card">
            <h3>Qualification note</h3>
            <p className="muted">
              Bounty requires deployment on an Arbitrum chain. Local Hardhat evidence is ready; live Sepolia
              addresses finalize eligibility once a funded deployer key is provided.
            </p>
          </section>
        </div>
      )}

      <footer className="footer">
        <span>Arb Guardian</span>
        <span className="muted">Teal shield brand · Arbitrum treasury ops</span>
      </footer>
    </div>
  );
}
