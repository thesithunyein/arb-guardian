import { useEffect, useMemo, useState, type ReactElement } from "react";
import { pingRpc, readOnchainPolicy, type OnchainPolicy } from "./chain";
import {
  API_BASE,
  API_KEY,
  DEPLOYMENT_READY,
  EXECUTION_GUARD,
  POLICY_MANAGER,
  RH_EXECUTION_GUARD,
  RH_POLICY_MANAGER,
  RH_READY,
  RH_SAFE_TREASURY_GUARD,
  RH_TREASURY_SAFE,
  SAFE_TREASURY_GUARD,
  TREASURY_SAFE,
  addressUrl,
  rhAddressUrl,
  txUrl
} from "./config";
import { BrandBackdrop } from "./BrandBackdrop";
import {
  IconAlerts,
  IconAutomation,
  IconCheck,
  IconFreeze,
  IconHome,
  IconMoon,
  IconPayment,
  IconPolicy,
  IconReview,
  IconSecurity,
  IconSoundOff,
  IconSoundOn,
  IconSpark,
  IconSun
} from "./icons";
import { assessIntent, predictGuardOutcome, type RiskAssessment } from "./riskEngine";
import {
  loadSfxMuted,
  setSfxMuted,
  sfxBadge,
  sfxBlock,
  sfxClick,
  sfxFreeze,
  sfxSuccess,
  sfxXp
} from "./sfx";
import { useTheme } from "./useTheme";

type BadgeKey = "firstCheck" | "firstBlock" | "firstFreeze" | "cleanPayout";
type BadgeState = Record<BadgeKey, boolean>;

const XP_STORAGE = "arb-guardian-xp-v1";
const BADGE_STORAGE = "arb-guardian-badges-v1";

const BADGE_LABEL: Record<BadgeKey, string> = {
  firstCheck: "First check",
  firstBlock: "Scam stopper",
  firstFreeze: "Bank freezer",
  cleanPayout: "Clean payout"
};

function loadXp() {
  try {
    const n = Number(localStorage.getItem(XP_STORAGE) ?? "0");
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

function loadBadges(): BadgeState {
  try {
    const raw = localStorage.getItem(BADGE_STORAGE);
    if (!raw) return { firstCheck: false, firstBlock: false, firstFreeze: false, cleanPayout: false };
    const parsed = JSON.parse(raw) as Partial<BadgeState>;
    return {
      firstCheck: !!parsed.firstCheck,
      firstBlock: !!parsed.firstBlock,
      firstFreeze: !!parsed.firstFreeze,
      cleanPayout: !!parsed.cleanPayout
    };
  } catch {
    return { firstCheck: false, firstBlock: false, firstFreeze: false, cleanPayout: false };
  }
}

type IncidentItem = {
  id: string;
  title: string;
  severity: string;
  recommendedPlaybook: string;
  status: string;
};

type PlaybookExecution = {
  playbook: string;
  executed: boolean;
  action: string | null;
  txHash: string | null;
  error: string | null;
  note?: string;
};

type AgentEvalSummary = {
  total: number;
  passed: number;
  accuracy: number;
  blockedPrecision: number;
  blockedRecall: number;
};

type IntentId = "risky-approve" | "limit-breach" | "safe-transfer";
type TabId = "home" | "review" | "alerts" | "automation" | "security";

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
    outcomeHint: string;
    vendor: string;
    walletLabel: string;
    amountEth: string;
    whyUsersCare: string;
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
    label: "Unknown marketplace approval",
    blurb: "A random in-game shop asks your guild bank to approve spending",
    outcomeHint: "unknown marketplace",
    vendor: "Unknown marketplace",
    walletLabel: "Guild signer A",
    amountEth: "1.00",
    whyUsersCare: "Stops scams that drain the guild bank with one bad approve",
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
    label: "Over daily prize budget",
    blurb: "Contributor payouts are allowed, but this one is bigger than today’s limit",
    outcomeHint: "over daily budget",
    vendor: "Contributor payouts (approved)",
    walletLabel: "Guild signer B",
    amountEth: "4.00",
    whyUsersCare: "Keeps prize / salary payouts inside the budget officers already set",
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
    label: "Normal contributor payout",
    blurb: "Paying a known contributor from the approved payout list",
    outcomeHint: "within guild rules",
    vendor: "Contributor payouts (approved)",
    walletLabel: "Guild signer C",
    amountEth: "1.00",
    whyUsersCare: "Fast green light for normal guild ops — no drama when rules are clean",
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

const VENDOR_LABEL: Record<string, string> = {
  [TREASURY.payroll]: "Contributor payouts (approved)",
  [TREASURY.unlisted]: "Unknown marketplace",
  [TREASURY.a]: "Guild signer A",
  [TREASURY.b]: "Guild signer B",
  [TREASURY.c]: "Guild signer C"
};

const PLAYBOOK_LABELS: Record<string, string> = {
  "freeze-wallet-and-revoke-approvals": "Freeze guild spending",
  "hold-transaction-and-require-admin-review": "Hold for guild officer review",
  "request-secondary-signer-confirmation": "Ask a second guild signer",
  "allow-with-monitoring": "Allow and keep watching"
};

function playbookLabel(id: string) {
  return PLAYBOOK_LABELS[id] ?? id.replace(/-/g, " ");
}

function plainOutcome(assessment: RiskAssessment, intentId: IntentId) {
  if (!assessment.blocked) return "Allow — safe for the guild";
  const hint = INTENTS[intentId].outcomeHint;
  if (assessment.totalScore >= 80) return `Block — ${hint}`;
  return `Hold — ${hint}`;
}

function methodLabel(method: string) {
  if (method === "approve") return "Spend approval";
  if (method === "transfer") return "Guild payout";
  return method;
}

function formatEth(wei: string) {
  const n = Number(wei) / 1e18;
  if (!Number.isFinite(n)) return "—";
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 4 })} ETH`;
}

function vendorName(addr: string) {
  return VENDOR_LABEL[addr] ?? `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function App() {
  const { theme, toggleTheme } = useTheme();
  const [tab, setTab] = useState<TabId>("home");
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
  const [lastPlaybook, setLastPlaybook] = useState<PlaybookExecution | null>(null);
  const [agentEval, setAgentEval] = useState<AgentEvalSummary | null>(null);
  const [policyPaused, setPolicyPaused] = useState<boolean | null>(null);
  const [whyOpen, setWhyOpen] = useState(false);
  const [xp, setXp] = useState(() => loadXp());
  const [xpToast, setXpToast] = useState<string | null>(null);
  const [badges, setBadges] = useState<BadgeState>(() => loadBadges());
  const [sfxMuted, setSfxMutedState] = useState(() => loadSfxMuted());
  const [cutscene, setCutscene] = useState<string | null>(null);
  const [entered, setEntered] = useState(() => {
    try {
      return localStorage.getItem("arb-guardian-entered-v1") === "1";
    } catch {
      return false;
    }
  });
  const [storySeen, setStorySeen] = useState(() => {
    try {
      return localStorage.getItem("arb-guardian-story-v1") === "1";
    } catch {
      return false;
    }
  });
  const [openPane, setOpenPane] = useState<"log" | "howto" | "badges" | "assets" | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);

  const level = Math.floor(xp / 100) + 1;
  const xpIntoLevel = xp % 100;
  const xpPct = Math.min(100, (xpIntoLevel / 100) * 100);

  useEffect(() => {
    try {
      localStorage.setItem(XP_STORAGE, String(xp));
    } catch {
      // ignore
    }
  }, [xp]);

  useEffect(() => {
    try {
      localStorage.setItem(BADGE_STORAGE, JSON.stringify(badges));
    } catch {
      // ignore
    }
  }, [badges]);

  function toggleMute() {
    const next = !sfxMuted;
    setSfxMuted(next);
    setSfxMutedState(next);
    if (!next) void sfxClick();
  }

  function enterWorld() {
    setEntered(true);
    try {
      localStorage.setItem("arb-guardian-entered-v1", "1");
    } catch {
      // ignore
    }
    void sfxClick();
  }

  function finishStory() {
    setStorySeen(true);
    try {
      localStorage.setItem("arb-guardian-story-v1", "1");
    } catch {
      // ignore
    }
    void sfxClick();
  }

  function startFirstCheck() {
    finishStory();
    goQuests("risky-approve");
  }

  function togglePane(id: typeof openPane) {
    void sfxClick();
    setOpenPane((prev) => (prev === id ? null : id));
  }

  function goQuests(intentId?: IntentId) {
    void sfxClick();
    if (!entered) {
      setEntered(true);
      try {
        localStorage.setItem("arb-guardian-entered-v1", "1");
      } catch {
        // ignore
      }
    }
    if (intentId) setIntent(intentId);
    setTab("review");
  }

  function awardXp(amount: number, label: string, badgeKey?: BadgeKey, tone: "xp" | "block" | "success" | "freeze" = "xp") {
    setXp((v) => v + amount);
    setXpToast(`+${amount} XP · ${label}`);
    window.setTimeout(() => setXpToast(null), 2200);
    if (tone === "block") void sfxBlock();
    else if (tone === "success") void sfxSuccess();
    else if (tone === "freeze") void sfxFreeze();
    else void sfxXp();
    if (badgeKey && !badges[badgeKey]) {
      setBadges((b) => ({ ...b, [badgeKey]: true }));
      setCutscene(BADGE_LABEL[badgeKey]);
      void sfxBadge();
    }
  }

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

  function recordLocal(result: RiskAssessment, txHash: string, _wallet: string) {
    setAssessment(result);
    setWhyOpen(false);
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
    if (!result.blocked) {
      if (intent === "safe-transfer") awardXp(25, "Clean payout", "cleanPayout", "success");
      else awardXp(15, "Guild check", "firstCheck", "success");
      return;
    }
    awardXp(40, "Blocked a scam path", "firstBlock", "block");
    const item: IncidentItem = {
      id: `inc-${txHash}`,
      title: `Blocked · ${INTENTS[intent].vendor} · ${INTENTS[intent].amountEth} ETH`,
      severity: result.totalScore >= 80 ? "critical" : "high",
      recommendedPlaybook: result.recommendedPlaybook,
      status: "open"
    };
    setIncidents((prev) => [item, ...prev.filter((i) => i.id !== item.id)].slice(0, 12));
    setTab("alerts");
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
          fetch(`${API_BASE}/kpi`).then((r) => r.json()),
          fetch(`${API_BASE}/agent/eval`)
            .then((r) => r.json())
            .catch(() => null),
          fetch(`${API_BASE}/policy`)
            .then((r) => r.json())
            .catch(() => null)
        ]);
      })
      .then(([incidentsData, kpiData, evalData, policyData]) => {
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
        if (evalData?.summary) setAgentEval(evalData.summary as AgentEvalSummary);
        if (policyData && typeof policyData.paused === "boolean") setPolicyPaused(policyData.paused);
      })
      .catch(() => setRuntime("onchain-console"));
  }, []);

  async function runAssessment() {
    setLoading(true);
    setError(null);
    setWhyOpen(false);
    setTab("review");
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
            amountWei: payload.amountWei,
            allowlisted: payload.allowlisted,
            dailyLimitWei: payload.dailyLimitWei,
            spentTodayWei: payload.spentTodayWei
          })
        });
        if (!res.ok) throw new Error(`Review failed (${res.status})`);
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
        awardXp(
          result.blocked ? 40 : intent === "safe-transfer" ? 25 : 15,
          result.blocked ? "Blocked a scam path" : intent === "safe-transfer" ? "Clean payout" : "Guild check",
          result.blocked ? "firstBlock" : intent === "safe-transfer" ? "cleanPayout" : "firstCheck",
          result.blocked ? "block" : "success"
        );
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
          setTab("alerts");
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
      setError(err instanceof Error ? err.message : "Review failed");
    } finally {
      setLoading(false);
    }
  }

  async function applyAction(incidentId: string, action: "acknowledge" | "mitigate" | "ignore") {
    setError(null);
    try {
      if (runtime === "api" && API_BASE) {
        const target = incidents.find((i) => i.id === incidentId);
        const actionRes = await fetch(`${API_BASE}/incidents/${incidentId}/action`, {
          method: "POST",
          headers: buildHeaders(true),
          body: JSON.stringify({
            action,
            actor: "guild-officer",
            incident: target
              ? {
                  id: target.id,
                  title: target.title,
                  severity: target.severity,
                  status: target.status,
                  recommendedPlaybook: target.recommendedPlaybook,
                  wallet: "",
                  details: "",
                  evidence: [],
                  createdAt: new Date().toISOString()
                }
              : undefined
          })
        });
        if (!actionRes.ok) throw new Error(`Action failed (${actionRes.status})`);
        const actionBody = (await actionRes.json()) as { playbookExecution?: PlaybookExecution | null };
        if (actionBody.playbookExecution) {
          setLastPlaybook(actionBody.playbookExecution);
          if (actionBody.playbookExecution.action === "policy_manager.pause") {
            setPolicyPaused(true);
            awardXp(60, "Froze the guild bank", "firstFreeze", "freeze");
          }
        }
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
        { incidentId, action, actor: "guild-officer", createdAt: new Date().toISOString() },
        ...prev
      ]);
      if (action === "mitigate") awardXp(60, "Froze the guild bank", "firstFreeze", "freeze");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    }
  }

  async function unpausePolicy() {
    if (!API_BASE) return;
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/policy`, {
        method: "POST",
        headers: buildHeaders(true),
        body: JSON.stringify({ op: "unpause" })
      });
      if (!res.ok) throw new Error(`Resume failed (${res.status})`);
      const body = (await res.json()) as { txHash?: string };
      setPolicyPaused(false);
      setLastPlaybook({
        playbook: "operator-unpause",
        executed: true,
        action: "policy_manager.unpause",
        txHash: body.txHash ?? null,
        error: null
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Resume failed");
    }
  }

  const openIncidents = incidents.filter((i) => i.status === "open").length;
  const statusLabel = policyPaused ? "Frozen" : DEPLOYMENT_READY ? "Online" : "Ready";

  const coreTabs: Array<[TabId, string, ReactElement]> = [
    ["home", "Home", <IconHome key="h" size={16} />],
    ["review", "Check spend", <IconReview key="r" size={16} />],
    ["alerts", openIncidents ? `Alerts (${openIncidents})` : "Alerts", <IconAlerts key="a" size={16} />]
  ];
  const moreTabs: Array<[TabId, string, ReactElement]> = [
    ["automation", "Playbooks", <IconAutomation key="u" size={16} />],
    ["security", "Vault", <IconSecurity key="s" size={16} />]
  ];

  return (
    <>
      <BrandBackdrop />
      {xpToast && <div className="xp-toast">{xpToast}</div>}
      {cutscene && (
        <div className="cutscene" role="dialog" aria-modal="true" aria-label="Badge unlocked">
          <div className="cutscene-card">
            <h3>Badge unlocked!</h3>
            <p>
              You earned <strong>{cutscene}</strong>. Progress stays on this device — keep protecting the guild bank.
            </p>
            <button
              type="button"
              className="primary"
              onClick={() => {
                void sfxClick();
                setCutscene(null);
              }}
            >
              Continue adventure
            </button>
          </div>
        </div>
      )}
      <div className={`app-shell ${entered ? "entered" : "title-screen"}`}>
      <header className="topbar">
        <a className="brand" href="/" aria-label="Arb Guardian home">
          <span className="brand-mark-frame">
            <img src="/logo.png" alt="" width={44} height={44} />
          </span>
          <div className="brand-mark">
            <h1 className="brand-title">
              <span className="accent">Arb</span> Guardian
            </h1>
            <p className="brand-sub">Guild Quest</p>
          </div>
        </a>
        <div className="topbar-actions">
          {entered && (
            <div className="xp-hud" title={`${xp} total XP`}>
              <div className="level-badge">Lv{level}</div>
              <div className="xp-meta">
                <strong>{xpIntoLevel}/100 XP</strong>
                <div className="xp-bar" aria-hidden="true">
                  <i style={{ width: `${xpPct}%` }} />
                </div>
              </div>
            </div>
          )}
          {entered && (
            <span className={`chip ${policyPaused ? "warn" : "ok"}`} title={rpcLive ? "Live" : "Connecting"}>
              {!policyPaused && <span className="pulse-dot" />}
              {statusLabel}
            </span>
          )}
          <button
            type="button"
            className={`icon-btn ${sfxMuted ? "" : "active"}`}
            onClick={toggleMute}
            aria-label={sfxMuted ? "Unmute sounds" : "Mute sounds"}
            title={sfxMuted ? "Sound off" : "Sound on"}
          >
            {sfxMuted ? <IconSoundOff size={16} /> : <IconSoundOn size={16} />}
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => {
              void sfxClick();
              toggleTheme();
            }}
            aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
          >
            {theme === "light" ? <IconMoon size={16} /> : <IconSun size={16} />}
          </button>
        </div>
      </header>

      {!entered ? (
        <section className="hero title-hero">
          <img className="hero-logo" src="/logo.png" alt="Arb Guardian" width={112} height={112} />
          <h2>
            <span className="accent">Arb</span> Guardian
          </h2>
          <p className="hero-lead plain-lead">
            Your guild shares one bank for prizes and payouts.
            <br />
            Fake shops try to drain it. Check a spend here <em>before</em> anyone signs.
          </p>
          <div className="cta-row">
            <button type="button" className="primary" onClick={enterWorld}>
              Press start
            </button>
          </div>
          <p className="title-hint muted">Takes about a minute · no wallet needed to try</p>
          {error && <p className="error">{error}</p>}
        </section>
      ) : !storySeen ? (
        <section className="story-panel" aria-label="How Arb Guardian works">
          <p className="hero-kicker">60-SECOND STORY</p>
          <h2 className="compact-title">
            How this <span className="accent">works</span>
          </h2>
          <ol className="story-steps">
            <li>
              <strong>1 · Shared bank</strong>
              <span>The guild keeps prize money and contributor pay in one place.</span>
            </li>
            <li>
              <strong>2 · Someone asks to spend</strong>
              <span>A marketplace wants approval, or a payout is bigger than today’s budget.</span>
            </li>
            <li>
              <strong>3 · You check it</strong>
              <span>Safe → green light. Risky → block, then freeze the bank if needed.</span>
            </li>
          </ol>
          <div className="cta-row left">
            <button type="button" className="primary" onClick={startFirstCheck} disabled={loading}>
              {loading ? "Checking…" : "Try a scam check"}
            </button>
            <button type="button" className="ghost" onClick={finishStory}>
              Show me home first
            </button>
          </div>
        </section>
      ) : (
        <>
          <section className="hero compact-hero">
            <p className="hero-kicker">HOME</p>
            <h2 className="compact-title">
              Check the next <span className="accent">spend</span>
            </h2>
            <p className="hero-lead">
              Pick a spend → see allow or block → if blocked, freeze from Alerts.
            </p>
            <div className="cta-row">
              <button type="button" className="primary" onClick={() => goQuests("risky-approve")} disabled={loading}>
                <IconPayment size={16} />
                {loading ? "Checking…" : "Check a spend"}
              </button>
              {openIncidents > 0 && (
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    void sfxClick();
                    setTab("alerts");
                  }}
                >
                  <IconAlerts size={16} />
                  {openIncidents} alert{openIncidents === 1 ? "" : "s"}
                </button>
              )}
            </div>
            {error && <p className="error">{error}</p>}
          </section>

          <nav className="tabs" aria-label="Primary">
            {coreTabs.map(([id, label, icon]) => (
              <button
                key={id}
                type="button"
                className={`tab ${tab === id ? "active" : ""}`}
                onClick={() => {
                  void sfxClick();
                  setTab(id);
                }}
              >
                {icon}
                {label}
              </button>
            ))}
            <div className="more-wrap">
              <button
                type="button"
                className={`tab ${moreOpen || moreTabs.some(([id]) => id === tab) ? "active" : ""}`}
                onClick={() => {
                  void sfxClick();
                  setMoreOpen((v) => !v);
                }}
                aria-expanded={moreOpen}
              >
                More
              </button>
              {moreOpen && (
                <div className="more-menu" role="menu">
                  {moreTabs.map(([id, label, icon]) => (
                    <button
                      key={id}
                      type="button"
                      role="menuitem"
                      className={tab === id ? "active" : ""}
                      onClick={() => {
                        void sfxClick();
                        setTab(id);
                        setMoreOpen(false);
                      }}
                    >
                      {icon}
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </nav>

          <div className="panel" key={tab}>
            {tab === "home" && (
              <div className="home-stack">
                <section className="policy-snapshot" aria-label="Guild bank status">
                  <div>
                    <p className="snapshot-label">Guild bank</p>
                    <strong>{policyPaused ? "Frozen — spending stopped" : "Ready to check spends"}</strong>
                    <p className="muted">Daily prize budget on · scam marketplace checks on</p>
                  </div>
                  <div className="snapshot-actions">
                    <button type="button" className="primary" onClick={() => goQuests("risky-approve")}>
                      <IconPayment size={16} />
                      Check a spend
                    </button>
                  </div>
                </section>

                <section className="section reveal always-on">
                  <h3>Start here</h3>
                  <p className="muted section-lead">Three practice spends. Do the first one — it’s the scam guilds hit most.</p>
                  <div className="retain-grid">
                    {(Object.keys(INTENTS) as IntentId[]).map((id) => (
                      <button key={id} type="button" className="retain-card" onClick={() => goQuests(id)}>
                        <strong>{INTENTS[id].label}</strong>
                        <span>{INTENTS[id].blurb}</span>
                        <em>{id === "risky-approve" ? "Best first try →" : "Try this →"}</em>
                      </button>
                    ))}
                  </div>
                </section>

                <section className="door-row" aria-label="Optional details">
                  {(
                    [
                      ["howto", "How it works", "3 steps"],
                      ["assets", "What’s protected", "Bank items"],
                      ["log", "Your wins", "Checklist"],
                      ["badges", "Badges", `${Object.values(badges).filter(Boolean).length}/4`]
                    ] as const
                  ).map(([id, title, hint]) => (
                    <button
                      key={id}
                      type="button"
                      className={`door ${openPane === id ? "open" : ""}`}
                      onClick={() => togglePane(id)}
                      aria-expanded={openPane === id}
                    >
                      <strong>{title}</strong>
                      <span>{hint}</span>
                    </button>
                  ))}
                </section>

                {openPane === "assets" && (
                  <section className="section reveal">
                    <h3>
                      <IconSecurity size={18} /> Guild assets · live inventory
                    </h3>
                    <p className="muted section-lead">
                      Real controls officers manage every day — shown like inventory, enforced onchain.
                    </p>
                    <div className="asset-grid">
                      <article className="asset-card">
                        <strong>Prize pot / bank</strong>
                        <span>{policyPaused ? "Frozen" : "Protected"}</span>
                        <p>Shared ETH the guild cannot afford to drain.</p>
                      </article>
                      <article className="asset-card">
                        <strong>Approved payouts</strong>
                        <span>Allowlist on</span>
                        <p>Only known contributor destinations pass clean.</p>
                      </article>
                      <article className="asset-card">
                        <strong>Daily prize budget</strong>
                        <span>Limit live</span>
                        <p>Over-budget payouts get held or blocked.</p>
                      </article>
                      <article className="asset-card">
                        <strong>Marketplace gate</strong>
                        <span>Scam path blocked</span>
                        <p>Unknown approve requests open Alerts — not silent drains.</p>
                      </article>
                      <article className="asset-card">
                        <strong>Freeze switch</strong>
                        <span>Officer gated</span>
                        <p>Suggestions appear automatically — freezing still needs your click.</p>
                      </article>
                      <article className="asset-card">
                        <strong>Networks</strong>
                        <span>Live</span>
                        <p>Protection runs on live networks — details in More → Vault.</p>
                      </article>
                    </div>
                    <div className="cta-row left" style={{ marginTop: "0.85rem" }}>
                      <button type="button" className="primary" onClick={() => goQuests("risky-approve")}>
                        Test marketplace gate
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => {
                          void sfxClick();
                          setTab("security");
                        }}
                      >
                        Open Vault
                      </button>
                    </div>
                  </section>
                )}

                {openPane === "log" && (
                  <section className="section reveal" id="quest-log">
                    <h3>
                      <IconSpark size={18} /> Quest log · first wins
                    </h3>
                    <p className="muted section-lead">
                      Clear these in under 10 minutes. Each step protects a real guild pain point — and awards XP.
                    </p>
                    <ul className="quest-check">
                      <li className={badges.firstBlock || kpi.blockedCount > 0 ? "done" : ""}>
                        <span className="tick">
                          <IconCheck size={12} />
                        </span>
                        <div>
                          <strong>Block a marketplace scam</strong>
                          <span>Unknown approve path — the drain guilds hit most.</span>
                        </div>
                      </li>
                      <li className={badges.cleanPayout ? "done" : ""}>
                        <span className="tick">
                          <IconCheck size={12} />
                        </span>
                        <div>
                          <strong>Green-light a clean payout</strong>
                          <span>Prove normal ops still feel fast when rules are clean.</span>
                        </div>
                      </li>
                      <li className={badges.firstFreeze || policyPaused ? "done" : ""}>
                        <span className="tick">
                          <IconCheck size={12} />
                        </span>
                        <div>
                          <strong>Officer freeze</strong>
                          <span>From Alerts, freeze guild spending with a shared activity log.</span>
                        </div>
                      </li>
                      <li className={badges.firstCheck || badges.firstBlock || badges.cleanPayout ? "done" : ""}>
                        <span className="tick">
                          <IconCheck size={12} />
                        </span>
                        <div>
                          <strong>Collect your first badge</strong>
                          <span>Progress saves on this device so the adventure continues.</span>
                        </div>
                      </li>
                    </ul>
                    <div className="cta-row left" style={{ marginTop: "0.85rem" }}>
                      <button type="button" className="primary" onClick={() => goQuests("risky-approve")}>
                        Play first quest
                      </button>
                    </div>
                  </section>
                )}

                {openPane === "howto" && (
                  <section className="section reveal" id="how-it-works">
                    <h3>How the adventure works</h3>
                    <ol className="howto">
                      <li>
                        <span className="step-icon">
                          <IconPolicy size={20} />
                        </span>
                        <strong>1 · Rules stay on</strong>
                        <span>Who can get paid + daily prize budget is already live. No setup grind to start.</span>
                      </li>
                      <li>
                        <span className="step-icon">
                          <IconPayment size={20} />
                        </span>
                        <strong>2 · Pick a quest spend</strong>
                        <span>Check marketplace approvals and payouts. Earn XP when you complete a check.</span>
                      </li>
                      <li>
                        <span className="step-icon">
                          <IconFreeze size={20} />
                        </span>
                        <strong>3 · Boss move: freeze</strong>
                        <span>If it’s blocked, freeze the guild bank or ping another officer — with a shared log.</span>
                      </li>
                    </ol>
                  </section>
                )}

                {openPane === "badges" && (
                  <section className="section reveal">
                    <h3>
                      <IconSpark size={18} /> Your badges
                    </h3>
                    <div className="badge-row">
                      <span
                        className={`badge-pill ${badges.firstCheck || badges.firstBlock || badges.cleanPayout ? "on" : ""}`}
                      >
                        First check
                      </span>
                      <span className={`badge-pill ${badges.firstBlock ? "on" : ""}`}>Scam stopper</span>
                      <span className={`badge-pill ${badges.firstFreeze ? "on" : ""}`}>Bank freezer</span>
                      <span className={`badge-pill ${badges.cleanPayout ? "on" : ""}`}>Clean payout</span>
                    </div>
                  </section>
                )}
              </div>
            )}

        {tab === "review" && (
          <div className="grid">
            <section className="surface">
              <h3>
                <IconReview size={18} /> Is this spend safe?
              </h3>
              <p className="muted" style={{ marginBottom: "0.85rem" }}>
                Choose one practice spend, then tap Check. You’ll get Allow or Block in plain language.
              </p>
              <div className="scenario-list">
                {(Object.keys(INTENTS) as IntentId[]).map((id) => (
                  <button
                    key={id}
                    type="button"
                    className={`scenario ${intent === id ? "active" : ""}`}
                    onClick={() => {
                      void sfxClick();
                      setIntent(id);
                    }}
                  >
                    <strong>{INTENTS[id].label}</strong>
                    <span>{INTENTS[id].blurb}</span>
                    <span className="scenario-meta">
                      {INTENTS[id].vendor} · {INTENTS[id].amountEth} ETH
                    </span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="primary full"
                onClick={() => {
                  void sfxClick();
                  void runAssessment();
                }}
                disabled={loading}
              >
                <IconCheck size={16} />
                {loading ? "Checking…" : "Check this spend"}
              </button>
            </section>

            <section className="surface">
              <h3>Spend summary</h3>
              <dl className="meta">
                <div>
                  <dt>Type</dt>
                  <dd>{methodLabel(payload.method)}</dd>
                </div>
                <div>
                  <dt>From</dt>
                  <dd>{INTENTS[intent].walletLabel}</dd>
                </div>
                <div>
                  <dt>To</dt>
                  <dd>{INTENTS[intent].vendor}</dd>
                </div>
                <div>
                  <dt>Amount</dt>
                  <dd>{formatEth(payload.amountWei)}</dd>
                </div>
                <div>
                  <dt>On approved list?</dt>
                  <dd>
                    {(policyState?.allowlisted ?? payload.allowlisted) ? "Yes" : "No"}
                  </dd>
                </div>
                <div>
                  <dt>Daily prize budget</dt>
                  <dd>
                    {policyState
                      ? `${policyState.dailyLimitEth} ETH`
                      : formatEth(payload.dailyLimitWei)}
                  </dd>
                </div>
                <div>
                  <dt>Spent today</dt>
                  <dd>
                    {policyState
                      ? `${policyState.spentTodayEth} ETH`
                      : formatEth(payload.spentTodayWei)}
                  </dd>
                </div>
              </dl>
            </section>

            <section className="surface span-2">
              <h3>Result</h3>
              {!assessment ? (
                <div className="empty-state">
                  <IconPayment size={28} />
                  <p>
                    Choose a practice spend, then tap <strong>Check this spend</strong>.
                  </p>
                  <p className="muted">
                    Start with Unknown marketplace approval — that’s the common guild scam path.
                  </p>
                </div>
              ) : (
                <>
                  <p className="result-line">
                    <span className={`status-pill ${assessment.blocked ? "blocked" : "allowed"}`}>
                      {assessment.blocked ? <IconAlerts size={14} /> : <IconCheck size={14} />}
                      {plainOutcome(assessment, intent)}
                    </span>
                  </p>
                  <p className="muted" style={{ marginBottom: "0.75rem" }}>
                    {assessment.blocked
                      ? "Do not sign in the wallet. Open Alerts to freeze the guild bank or escalate."
                      : "Guild rules look clean. Sign as usual — this is the everyday happy path."}
                  </p>
                  <p className="next-step">
                    Suggested next step: <strong>{playbookLabel(assessment.recommendedPlaybook)}</strong>
                  </p>
                  {guardPrediction && (
                    <p className="muted" style={{ marginTop: "0.5rem" }}>
                      Spend guard: {guardPrediction.wouldRevert ? "would stop this" : "would allow this"}
                    </p>
                  )}
                  <button type="button" className="linkish" onClick={() => setWhyOpen((v) => !v)}>
                    {whyOpen ? "Hide details" : "Why this decision"}
                  </button>
                  {whyOpen && (
                    <ul className="clean why-list">
                      {assessment.matches.length === 0 ? (
                        <li>No rule flags — destination and amount are inside guild limits.</li>
                      ) : (
                        assessment.matches.map((m) => (
                          <li key={m.ruleId}>
                            {m.reason}{" "}
                            <span className="muted">({m.severity})</span>
                          </li>
                        ))
                      )}
                      <li className="muted">
                        Counterparty: {vendorName(payload.destination)} · {formatEth(payload.amountWei)}
                      </li>
                    </ul>
                  )}
                  {assessment.blocked && (
                    <button
                      type="button"
                      className="primary"
                      style={{ marginTop: "0.85rem" }}
                      onClick={() => {
                        void sfxClick();
                        setTab("alerts");
                      }}
                    >
                      <IconAlerts size={16} />
                      Go to alerts
                    </button>
                  )}
                </>
              )}
            </section>
          </div>
        )}

        {tab === "alerts" && (
          <div className="grid">
            <section className="surface">
              <h3>
                <IconAlerts size={18} /> Alert queue
              </h3>
              <p className="muted" style={{ marginBottom: "0.85rem" }}>
                Shared queue for guild officers. Acknowledge, freeze the bank, or dismiss — every action stays in
                the activity log.
              </p>
              {incidents.length === 0 ? (
                <div className="empty-state">
                  <IconAlerts size={28} />
                  <p>No open alerts.</p>
                  <p className="muted">Check a risky spend to create one — then freeze from here.</p>
                  <button
                    type="button"
                    className="primary"
                    onClick={() => {
                      setIntent("risky-approve");
                      setTab("review");
                    }}
                  >
                    Check unknown marketplace approval
                  </button>
                </div>
              ) : (
                <ul className="incident-list">
                  {incidents.map((incident) => (
                    <li key={incident.id} className="incident-item">
                      <div className="incident-head">
                        <strong>{incident.title}</strong>
                        <span className={`sev sev-${incident.severity}`}>{incident.severity}</span>
                      </div>
                      <p className="muted">
                        {incident.status} · Recommended: {playbookLabel(incident.recommendedPlaybook)}
                      </p>
                      <div className="actions">
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => {
                            void sfxClick();
                            void applyAction(incident.id, "acknowledge");
                          }}
                        >
                          Acknowledge
                        </button>
                        <button
                          type="button"
                          className="primary"
                          onClick={() => {
                            void sfxClick();
                            void applyAction(incident.id, "mitigate");
                          }}
                        >
                          <IconFreeze size={14} />
                          Freeze guild spending
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => {
                            void sfxClick();
                            void applyAction(incident.id, "ignore");
                          }}
                        >
                          Dismiss
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="surface">
              <h3>Activity log</h3>
              {lastPlaybook && (
                <p className="next-step" style={{ marginBottom: "0.75rem" }}>
                  Last action: <strong>{lastPlaybook.action?.includes("pause") ? "Freeze guild spending" : lastPlaybook.action}</strong>
                  {lastPlaybook.txHash ? (
                    <>
                      {" · "}
                      <a href={txUrl(lastPlaybook.txHash)} target="_blank" rel="noreferrer">
                        view confirmation
                      </a>
                    </>
                  ) : null}
                  {lastPlaybook.error ? <span className="muted"> · {lastPlaybook.error}</span> : null}
                  {lastPlaybook.note ? <span className="muted"> · {lastPlaybook.note}</span> : null}
                </p>
              )}
              {policyPaused && (
                <button type="button" className="secondary" onClick={unpausePolicy} style={{ marginBottom: "0.75rem" }}>
                  Unfreeze guild bank (demo reset)
                </button>
              )}
              {auditLog.length === 0 && !lastPlaybook ? (
                <p className="muted">Operator actions appear here after you respond to an alert.</p>
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

        {tab === "automation" && (
          <div className="grid">
            <section className="surface span-2">
              <h3>
                <IconAutomation size={18} /> Suggested guild playbooks
              </h3>
              <p className="muted">
                Risk score maps to a fixed response officers can trust. Automation never moves guild funds.
                Freezing the bank still needs a human click on Alerts.
              </p>
              <button
                type="button"
                className="primary"
                style={{ marginTop: "0.75rem" }}
                onClick={async () => {
                  setIntent("risky-approve");
                  setTab("review");
                  await new Promise((r) => setTimeout(r, 50));
                  await runAssessment();
                  setTab("automation");
                }}
                disabled={loading}
              >
                {loading ? "Running…" : "Simulate marketplace scam"}
              </button>
              {assessment && (
                <div className="soft-box" style={{ marginTop: "1rem" }}>
                  <h4>Last suggestion</h4>
                  <p>
                    <strong>{playbookLabel(assessment.recommendedPlaybook)}</strong>
                  </p>
                  <p className="muted">
                    {assessment.blocked ? "Blocked → alert opened" : "Allowed"} · score {assessment.totalScore}
                  </p>
                </div>
              )}
              <div className="evidence-grid" style={{ marginTop: "1rem" }}>
                <article>
                  <h4>Low risk</h4>
                  <p>Allow with monitoring</p>
                </article>
                <article>
                  <h4>Medium</h4>
                  <p>Ask a second signer</p>
                </article>
                <article>
                  <h4>High</h4>
                  <p>Hold for admin review</p>
                </article>
                <article>
                  <h4>Critical</h4>
                  <p>Freeze guild spending (officer-approved)</p>
                </article>
              </div>
            </section>
            <section className="surface">
              <h3>Policy check accuracy</h3>
              {agentEval ? (
                <>
                  <p className="muted">
                    {agentEval.total} scenarios · accuracy {(agentEval.accuracy * 100).toFixed(0)}% · precision{" "}
                    {(agentEval.blockedPrecision * 100).toFixed(0)}% · recall{" "}
                    {(agentEval.blockedRecall * 100).toFixed(0)}%
                  </p>
                  <p>
                    Passed {agentEval.passed}/{agentEval.total}
                  </p>
                </>
              ) : (
                <p className="muted">12 scenarios · accuracy 100% in the automated harness.</p>
              )}
            </section>
            <section className="surface">
              <h3>Hard limits</h3>
              <ul className="clean">
                <li>Cannot move guild funds</li>
                <li>Cannot change approved payout lists</li>
                <li>Cannot grant officer admin access</li>
                <li>Freeze only after an officer clicks Freeze guild spending</li>
              </ul>
            </section>
          </div>
        )}

        {tab === "security" && (
          <div className="grid">
            <section className="surface span-2">
              <h3>
                <IconSecurity size={18} /> Guild Vault
              </h3>
              <p className="muted section-lead">
                Live networks and contract links for your guild bank. Day-to-day play stays in Quests and Alerts.
              </p>
              <div className="asset-grid">
                <article className="asset-card">
                  <strong>Prize pot</strong>
                  <span>{policyPaused ? "Frozen" : "Guarded"}</span>
                  <p>Shared bank funds protected by allowlist + daily budget.</p>
                </article>
                <article className="asset-card">
                  <strong>Spend guard</strong>
                  <span>Onchain</span>
                  <p>Unsafe spends can revert before they clear.</p>
                </article>
                <article className="asset-card">
                  <strong>Freeze</strong>
                  <span>Officer gated</span>
                  <p>Pause only after an officer confirms from Alerts.</p>
                </article>
                <article className="asset-card">
                  <strong>Playbooks</strong>
                  <span>Bounded</span>
                  <p>Automation never moves guild funds or changes the payout list.</p>
                </article>
                <article className="asset-card">
                  <strong>Arbitrum</strong>
                  <span>Live</span>
                  <p>Sepolia policy + guard + enrolled guild wallet.</p>
                </article>
                <article className="asset-card">
                  <strong>Robinhood</strong>
                  <span>{RH_READY ? "Live" : "Pending"}</span>
                  <p>{RH_READY ? "Testnet twin deploy for the same guild loop." : "Deployment pending."}</p>
                </article>
              </div>
            </section>
            <section className="surface">
              <h3>Arbitrum</h3>
              <ul className="clean">
                <li>
                  <a href={addressUrl(POLICY_MANAGER)} target="_blank" rel="noreferrer">
                    Policy controls
                  </a>
                </li>
                <li>
                  <a href={addressUrl(EXECUTION_GUARD)} target="_blank" rel="noreferrer">
                    Spend guard
                  </a>
                </li>
                {SAFE_TREASURY_GUARD && (
                  <li>
                    <a href={addressUrl(SAFE_TREASURY_GUARD)} target="_blank" rel="noreferrer">
                      Multisig guard
                    </a>
                  </li>
                )}
                {TREASURY_SAFE && (
                  <li>
                    <a href={addressUrl(TREASURY_SAFE)} target="_blank" rel="noreferrer">
                      Enrolled guild wallet
                    </a>
                  </li>
                )}
              </ul>
            </section>
            <section className="surface">
              <h3>Robinhood</h3>
              {RH_READY ? (
                <ul className="clean">
                  <li>
                    <a href={rhAddressUrl(RH_POLICY_MANAGER)} target="_blank" rel="noreferrer">
                      Policy controls
                    </a>
                  </li>
                  <li>
                    <a href={rhAddressUrl(RH_EXECUTION_GUARD)} target="_blank" rel="noreferrer">
                      Spend guard
                    </a>
                  </li>
                  {RH_SAFE_TREASURY_GUARD && (
                    <li>
                      <a href={rhAddressUrl(RH_SAFE_TREASURY_GUARD)} target="_blank" rel="noreferrer">
                        Multisig guard
                      </a>
                    </li>
                  )}
                  {RH_TREASURY_SAFE && (
                    <li>
                      <a href={rhAddressUrl(RH_TREASURY_SAFE)} target="_blank" rel="noreferrer">
                        Enrolled guild wallet
                      </a>
                    </li>
                  )}
                  <li>
                    <a href="https://explorer.testnet.chain.robinhood.com" target="_blank" rel="noreferrer">
                      Explorer
                    </a>
                  </li>
                </ul>
              ) : (
                <p className="muted">Robinhood network coming online.</p>
              )}
            </section>
            <section className="surface">
              <h3>Links</h3>
              <ul className="clean">
                <li>
                  <a href="https://arb-guardian.vercel.app" target="_blank" rel="noreferrer">
                    Live app
                  </a>
                </li>
                <li>
                  <a href="https://github.com/thesithunyein/arb-guardian" target="_blank" rel="noreferrer">
                    Source
                  </a>
                </li>
              </ul>
            </section>
          </div>
        )}
      </div>
          </>
      )}

      <footer className="footer">
        <div>
          Arb Guardian — guild bank protection that plays like a quest.
        </div>
        <div>
          <a href="https://github.com/thesithunyein/arb-guardian" target="_blank" rel="noreferrer">
            Repo
          </a>
          {" · "}
          <button
            type="button"
            className="linkish inline"
            onClick={() => {
              if (!entered) enterWorld();
              void sfxClick();
              setTab("security");
            }}
          >
            Security
          </button>
          {runtime === "api" ? " · Connected" : null}
        </div>
      </footer>
      </div>
    </>
  );
}
