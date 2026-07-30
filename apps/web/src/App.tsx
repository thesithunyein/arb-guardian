import { useEffect, useMemo, useState } from "react";
import { pingRpc, readOnchainPolicy, type OnchainPolicy } from "./chain";
import {
  API_BASE,
  API_KEY,
  CHAIN_NAME,
  DEPLOYMENT_READY,
  EXECUTION_GUARD,
  EXECUTION_GUARD_TX,
  POLICY_MANAGER,
  POLICY_MANAGER_TX,
  addressUrl,
  txUrl
} from "./config";
import { assessIntent, predictGuardOutcome, type RiskAssessment } from "./riskEngine";
import { useTheme } from "./useTheme";

type IncidentItem = {
  id: string;
  title: string;
  severity: string;
  recommendedPlaybook: string;
  status: string;
};

type IntentId = "risky-approve" | "limit-breach" | "safe-transfer";
type TabId = "overview" | "assess" | "incidents" | "agent" | "evidence";

const TREASURY = {
  a: "0x1111111111111111111111111111111111111111",
  b: "0x2222222222222222222222222222222222222222",
  c: "0x3333333333333333333333333333333333333333",
  payroll: "0x4444444444444444444444444444444444444444",
  unlisted: "0x5555555555555555555555555555555555555555"
};

const INTENTS: Record<
  IntentId,
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
    blurb: "Unlisted counterparty + approve surface",
    payload: {
      wallet: TREASURY.a,
      destination: TREASURY.unlisted,
      method: "approve",
      amountWei: "1000000000000000000",
      allowlisted: false,
      dailyLimitWei: "500000000000000000",
      spentTodayWei: "0"
    }
  },
  "limit-breach": {
    label: "Limit breach",
    blurb: "Allowlisted destination over daily ceiling",
    payload: {
      wallet: TREASURY.b,
      destination: TREASURY.payroll,
      method: "transfer",
      amountWei: "4000000000000000000",
      allowlisted: true,
      dailyLimitWei: "3000000000000000000",
      spentTodayWei: "0"
    }
  },
  "safe-transfer": {
    label: "Safe transfer",
    blurb: "Allowlisted destination within policy",
    payload: {
      wallet: TREASURY.c,
      destination: TREASURY.payroll,
      method: "transfer",
      amountWei: "1000000000000000000",
      allowlisted: true,
      dailyLimitWei: "5000000000000000000",
      spentTodayWei: "0"
    }
  }
};

export function App() {
  const { theme, toggleTheme } = useTheme();
  const [tab, setTab] = useState<TabId>("overview");
  const [intent, setIntent] = useState<IntentId>("risky-approve");
  const [assessment, setAssessment] = useState<RiskAssessment | null>(null);
  const [policyState, setPolicyState] = useState<OnchainPolicy | null>(null);
  const [guardPrediction, setGuardPrediction] = useState<{ wouldRevert: boolean; reason: string } | null>(
    null
  );
  const [incidents, setIncidents] = useState<IncidentItem[]>([]);
  const [auditLog, setAuditLog] = useState<
    Array<{ incidentId: string; action: string; actor: string; createdAt: string }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [kpi, setKpi] = useState({
    totalAssessments: 0,
    blockedCount: 0,
    blockedRate: 0,
    criticalIncidentCount: 0
  });
  const [error, setError] = useState<string | null>(null);
  const [runtime, setRuntime] = useState<"api" | "onchain-console">("onchain-console");
  const [rpcLive, setRpcLive] = useState(false);

  const payload = useMemo(() => {
    const base = INTENTS[intent].payload;
    return {
      txHash: `0xintent-${intent}-${Date.now().toString(16)}`,
      ...base
    };
  }, [intent]);

  function buildHeaders(includeApiKey = false): HeadersInit {
    const headers: HeadersInit = { "Content-Type": "application/json" };
    if (includeApiKey && API_KEY) headers["x-api-key"] = API_KEY;
    return headers;
  }

  function recordLocal(result: RiskAssessment, txHash: string, wallet: string) {
    setAssessment(result);
    setKpi((prev) => {
      const totalAssessments = prev.totalAssessments + 1;
      const blockedCount = prev.blockedCount + (result.blocked ? 1 : 0);
      return {
        totalAssessments,
        blockedCount,
        blockedRate: Number((blockedCount / totalAssessments).toFixed(4)),
        criticalIncidentCount:
          prev.criticalIncidentCount + (result.blocked && result.totalScore >= 80 ? 1 : 0)
      };
    });
    if (!result.blocked) return;
    const item: IncidentItem = {
      id: `inc-${txHash}`,
      title: `Blocked intent · ${wallet.slice(0, 8)}…`,
      severity: result.totalScore >= 80 ? "critical" : "high",
      recommendedPlaybook: result.recommendedPlaybook,
      status: "open"
    };
    setIncidents((prev) => [item, ...prev.filter((i) => i.id !== item.id)].slice(0, 12));
    setTab("incidents");
  }

  useEffect(() => {
    pingRpc().then(setRpcLive);
    if (!API_BASE) {
      setRuntime("onchain-console");
      return;
    }
    fetch(`${API_BASE}/health`)
      .then((res) => {
        if (!res.ok) throw new Error("offline");
        setRuntime("api");
        return Promise.all([
          fetch(`${API_BASE}/incidents`).then((r) => r.json()),
          fetch(`${API_BASE}/kpi`).then((r) => r.json())
        ]);
      })
      .then(([incidentsData, kpiData]) => {
        setIncidents((incidentsData as { items: IncidentItem[] }).items ?? []);
        const k = kpiData as {
          totalAssessments: number;
          blockedCount: number;
          blockedRate: number;
          criticalIncidentCount: number;
        };
        setKpi({
          totalAssessments: k.totalAssessments,
          blockedCount: k.blockedCount,
          blockedRate: k.blockedRate,
          criticalIncidentCount: k.criticalIncidentCount
        });
      })
      .catch(() => setRuntime("onchain-console"));
  }, []);

  async function runAssessment() {
    setLoading(true);
    setError(null);
    setTab("assess");
    try {
      if (runtime === "api" && API_BASE) {
        const res = await fetch(`${API_BASE}/risk/assess`, {
          method: "POST",
          headers: buildHeaders(true),
          body: JSON.stringify({
            txHash: payload.txHash,
            wallet: payload.wallet,
            destination: payload.destination,
            method: payload.method,
            amountWei: payload.amountWei
          })
        });
        if (!res.ok) throw new Error(`Assessment failed (${res.status})`);
        const data = (await res.json()) as {
          assessment: RiskAssessment & { matches: RiskAssessment["matches"] };
          incident: null | { id: string; title: string; recommendedPlaybook: string };
          policyState?: OnchainPolicy;
        };
        const result: RiskAssessment = {
          totalScore: data.assessment.totalScore,
          blocked: data.assessment.blocked,
          matches: data.assessment.matches,
          recommendedPlaybook: data.incident?.recommendedPlaybook ?? assessIntent(payload).recommendedPlaybook
        };
        setAssessment(result);
        if (data.policyState) setPolicyState(data.policyState);
        setGuardPrediction(
          predictGuardOutcome({
            allowlisted: data.policyState?.allowlisted ?? payload.allowlisted,
            dailyLimitWei: data.policyState?.dailyLimitWei ?? payload.dailyLimitWei,
            spentTodayWei: data.policyState?.spentTodayWei ?? payload.spentTodayWei,
            amountWei: payload.amountWei
          })
        );
        if (data.incident) {
          setIncidents((prev) => [
            {
              id: data.incident!.id,
              title: data.incident!.title,
              severity: result.totalScore >= 80 ? "critical" : "high",
              recommendedPlaybook: data.incident!.recommendedPlaybook,
              status: "open"
            },
            ...prev.filter((i) => i.id !== data.incident!.id)
          ]);
          setTab("incidents");
        }
        return;
      }

      let policy = payload;
      try {
        const onchain = await readOnchainPolicy(payload.wallet, payload.destination);
        if (onchain) {
          setPolicyState(onchain);
          policy = {
            ...payload,
            allowlisted: onchain.allowlisted,
            dailyLimitWei: onchain.dailyLimitWei,
            spentTodayWei: onchain.spentTodayWei
          };
        } else {
          setPolicyState(null);
        }
      } catch {
        setPolicyState(null);
      }

      const result = assessIntent(policy);
      const prediction = predictGuardOutcome(policy);
      setGuardPrediction(prediction);
      recordLocal(result, payload.txHash, payload.wallet);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Assessment failed");
    } finally {
      setLoading(false);
    }
  }

  async function applyAction(incidentId: string, action: "acknowledge" | "mitigate" | "ignore") {
    setError(null);
    try {
      if (runtime === "api" && API_BASE) {
        const actionRes = await fetch(`${API_BASE}/incidents/${incidentId}/action`, {
          method: "POST",
          headers: buildHeaders(true),
          body: JSON.stringify({ action, actor: "treasury-operator" })
        });
        if (!actionRes.ok) throw new Error(`Action failed (${actionRes.status})`);
        const incidentsRes = await fetch(`${API_BASE}/incidents`);
        const body = (await incidentsRes.json()) as { items: IncidentItem[] };
        setIncidents(body.items);
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
        { incidentId, action, actor: "treasury-operator", createdAt: new Date().toISOString() },
        ...prev
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    }
  }

  const openIncidents = incidents.filter((i) => i.status === "open").length;

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Arb Guardian home">
          <img src="/logo.png" alt="Arb Guardian" width={44} height={44} />
          <div className="brand-mark">
            <h1 className="brand-title">
              <span className="accent">Arb</span> Guardian
            </h1>
            <p className="brand-sub">Treasury risk operations</p>
          </div>
        </a>
        <div className="topbar-actions">
          <span className={`chip ${DEPLOYMENT_READY ? "ok" : ""}`}>
            {DEPLOYMENT_READY ? "Arbitrum Sepolia" : "Pending deploy"}
          </span>
          <span className="chip">{rpcLive ? "RPC live" : "RPC cold"}</span>
          <span className="chip">{runtime === "api" ? "API connected" : "Onchain console"}</span>
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
        <p className="eyebrow">Live on Arbitrum Sepolia · Policy-bounded agentic ops</p>
        <h2>
          <span className="accent">Stop</span> unsafe treasury execution
        </h2>
        <p className="hero-lead">
          Onchain allowlists and limits. Deterministic risk evidence. Bounded playbooks operators can trust.
        </p>
        <div className="cta-row">
          <button type="button" className="primary" onClick={runAssessment} disabled={loading}>
            {loading ? "Assessing…" : "Assess treasury intent"}
          </button>
          <button type="button" className="ghost" onClick={() => setTab("evidence")}>
            View onchain proof
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </section>

      <nav className="tabs" aria-label="Primary">
        {(
          [
            ["overview", "Overview"],
            ["assess", "Assess"],
            ["incidents", openIncidents ? `Incidents (${openIncidents})` : "Incidents"],
            ["agent", "Agent"],
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

      <div className="panel">
        {tab === "overview" && (
          <div className="grid">
            <section className="card span-2">
              <h3>Operations metrics</h3>
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
            </section>

            <section className="card">
              <h3>Live deployment</h3>
              <dl className="meta">
                <div>
                  <dt>Network</dt>
                  <dd>{CHAIN_NAME}</dd>
                </div>
                <div>
                  <dt>PolicyManager</dt>
                  <dd className="mono">
                    <a href={addressUrl(POLICY_MANAGER)} target="_blank" rel="noreferrer">
                      {POLICY_MANAGER}
                    </a>
                  </dd>
                </div>
                <div>
                  <dt>ExecutionGuard</dt>
                  <dd className="mono">
                    <a href={addressUrl(EXECUTION_GUARD)} target="_blank" rel="noreferrer">
                      {EXECUTION_GUARD}
                    </a>
                  </dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{DEPLOYMENT_READY ? "Qualified · Arbitrum chain" : "Pending"}</dd>
                </div>
              </dl>
            </section>

            <section className="card">
              <h3>Policy controls</h3>
              <ul className="clean">
                <li>Counterparty allowlist enforced onchain</li>
                <li>Per-wallet daily spend ceiling</li>
                <li>RBAC + pausable circuit breaker</li>
                <li>Approve surface requires review</li>
              </ul>
            </section>

            <section className="card span-2">
              <h3>Control loop</h3>
              <ol className="steps">
                <li>Policy</li>
                <li>Assess</li>
                <li>Block</li>
                <li>Incident</li>
                <li>Mitigate</li>
              </ol>
            </section>
          </div>
        )}

        {tab === "assess" && (
          <div className="grid">
            <section className="card">
              <h3>Treasury intent</h3>
              <div className="scenario-list">
                {(Object.keys(INTENTS) as IntentId[]).map((id) => (
                  <button
                    key={id}
                    type="button"
                    className={`scenario ${intent === id ? "active" : ""}`}
                    onClick={() => setIntent(id)}
                  >
                    <strong>{INTENTS[id].label}</strong>
                    <span>{INTENTS[id].blurb}</span>
                  </button>
                ))}
              </div>
              <button type="button" className="primary full" onClick={runAssessment} disabled={loading}>
                {loading ? "Assessing…" : "Run risk assessment"}
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
                  <dt>Policy source</dt>
                  <dd>{policyState ? "Onchain Sepolia" : "Intent template"}</dd>
                </div>
                {policyState && (
                  <>
                    <div>
                      <dt>Allowlisted</dt>
                      <dd>{policyState.allowlisted ? "Yes" : "No"}</dd>
                    </div>
                    <div>
                      <dt>Daily limit</dt>
                      <dd>{policyState.dailyLimitEth} ETH</dd>
                    </div>
                    <div>
                      <dt>Spent today</dt>
                      <dd>{policyState.spentTodayEth} ETH</dd>
                    </div>
                  </>
                )}
              </dl>
            </section>

            <section className="card span-2">
              <h3>Risk result</h3>
              {!assessment ? (
                <p className="muted">Select an intent and run assessment against policy.</p>
              ) : (
                <>
                  <p className="result-line">
                    Score <strong>{assessment.totalScore}</strong>
                    <span className={`status-pill ${assessment.blocked ? "blocked" : "allowed"}`}>
                      {assessment.blocked ? "Blocked" : "Allowed"}
                    </span>
                  </p>
                  <ul className="clean">
                    {assessment.matches.length === 0 ? (
                      <li>No rule matches — intent within policy.</li>
                    ) : (
                      assessment.matches.map((m) => (
                        <li key={m.ruleId}>
                          <strong>{m.ruleId}</strong> — {m.reason}{" "}
                          <span className="muted">
                            ({m.severity}, +{m.scoreDelta})
                          </span>
                        </li>
                      ))
                    )}
                  </ul>
                  <p className="playbook">
                    Playbook: <span className="mono">{assessment.recommendedPlaybook}</span>
                  </p>
                  {guardPrediction && (
                    <p className="playbook">
                      ExecutionGuard prediction:{" "}
                      <span className={`status-pill ${guardPrediction.wouldRevert ? "blocked" : "allowed"}`}>
                        {guardPrediction.wouldRevert ? "Would revert" : "Would allow"}
                      </span>{" "}
                      <span className="mono">{guardPrediction.reason}</span>
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
                <p className="muted">No open incidents. Assess a risky intent to create one.</p>
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
                <p className="muted">Operator actions appear here after acknowledge / mitigate / ignore.</p>
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

        {tab === "agent" && (
          <div className="grid">
            <section className="card span-2">
              <h3>Policy-bounded agent</h3>
              <p className="muted">
                Deterministic playbook selection from risk score. No free-form tool use. Critical mitigations can
                pause PolicyManager onchain when operator key is configured.
              </p>
              <div className="evidence-grid" style={{ marginTop: "1rem" }}>
                <article>
                  <h4>0–29 · Monitor</h4>
                  <p className="mono">allow-with-monitoring</p>
                </article>
                <article>
                  <h4>30–59 · Confirm</h4>
                  <p className="mono">request-secondary-signer-confirmation</p>
                </article>
                <article>
                  <h4>60–79 · Hold</h4>
                  <p className="mono">hold-transaction-and-require-admin-review</p>
                </article>
                <article>
                  <h4>≥80 · Freeze</h4>
                  <p className="mono">freeze-wallet-and-revoke-approvals → pause()</p>
                </article>
              </div>
            </section>
            <section className="card">
              <h3>Eval harness</h3>
              <p className="muted">12 scenarios · accuracy 1.0 · precision/recall tracked in CI.</p>
              <p className="mono">npm run eval:agent -w apps/api</p>
            </section>
            <section className="card">
              <h3>Hard bounds</h3>
              <ul className="clean">
                <li>Cannot move funds</li>
                <li>Cannot change allowlists</li>
                <li>Cannot grant admin roles</li>
                <li>Pause only after human mitigate</li>
              </ul>
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
                  <p>OZ AccessControl + Pausable, custom errors, RBAC, Hardhat tests.</p>
                </article>
                <article>
                  <h4>Product-market fit</h4>
                  <p>Treasury ops console for DAOs and onchain startups on Arbitrum.</p>
                </article>
                <article>
                  <h4>Innovation</h4>
                  <p>Evidence-first scoring + policy-bounded agentic playbooks.</p>
                </article>
                <article>
                  <h4>Real problem solving</h4>
                  <p>Blocks unsafe approvals/transfers before execution with audit trail.</p>
                </article>
              </div>
            </section>
            <section className="card">
              <h3>Onchain proof</h3>
              <ul className="clean">
                <li>
                  <a href={addressUrl(POLICY_MANAGER)} target="_blank" rel="noreferrer">
                    PolicyManager
                  </a>
                </li>
                <li>
                  <a href={addressUrl(EXECUTION_GUARD)} target="_blank" rel="noreferrer">
                    ExecutionGuard
                  </a>
                </li>
                <li>
                  <a href={txUrl(POLICY_MANAGER_TX)} target="_blank" rel="noreferrer">
                    Deploy tx · Policy
                  </a>
                </li>
                <li>
                  <a href={txUrl(EXECUTION_GUARD_TX)} target="_blank" rel="noreferrer">
                    Deploy tx · Guard
                  </a>
                </li>
              </ul>
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
                    Live product
                  </a>
                </li>
                <li>Qualified: Arbitrum Sepolia</li>
              </ul>
            </section>
          </div>
        )}
      </div>

      <footer className="footer">
        <div>
          Arb Guardian · <strong>Arbitrum</strong> treasury risk ops
        </div>
        <div>
          <a href="https://github.com/thesithunyein/arb-guardian" target="_blank" rel="noreferrer">
            Repo
          </a>
          {" · "}
          <a href={addressUrl(POLICY_MANAGER)} target="_blank" rel="noreferrer">
            Contracts
          </a>
        </div>
      </footer>
    </div>
  );
}
