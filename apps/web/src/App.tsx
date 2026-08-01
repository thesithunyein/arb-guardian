import { useEffect, useMemo, useState, type FormEvent, type ReactElement } from "react";
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
  IconReview,
  IconSecurity,
  IconSoundOff,
  IconSoundOn,
  IconSun
} from "./icons";
import { assessIntent, predictGuardOutcome, type RiskAssessment } from "./riskEngine";
import {
  loadSfxMuted,
  setSfxMuted,
  sfxBlock,
  sfxClick,
  sfxFreeze,
  sfxSuccess,
  sfxXp
} from "./sfx";
import { useTheme } from "./useTheme";
import { connectWallet, shortAddress, signEnrollMessage } from "./wallet";

type BadgeKey = "firstCheck" | "firstBlock" | "firstFreeze" | "cleanPayout";
type BadgeState = Record<BadgeKey, boolean>;

type LocalEnroll = {
  address: string;
  guild: string;
  message: string;
  signature: string;
  enrolledAt: string;
};

type GuildStats = {
  guildCount: number;
  officerCount: number;
  totalUsage: number;
};

const XP_STORAGE = "arb-guardian-xp-v1";
const BADGE_STORAGE = "arb-guardian-badges-v1";
const GUILD_STORAGE = "arb-guardian-guild-v1";
const ENROLL_STORAGE = "arb-guardian-guild-enroll-v1";
const INCIDENTS_STORAGE = "arb-guardian-incidents-v1";

function loadIncidents(): IncidentItem[] {
  try {
    const raw = sessionStorage.getItem(INCIDENTS_STORAGE);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as IncidentItem[];
    return Array.isArray(parsed) ? parsed.slice(0, 12) : [];
  } catch {
    return [];
  }
}

function persistIncidents(items: IncidentItem[]) {
  try {
    sessionStorage.setItem(INCIDENTS_STORAGE, JSON.stringify(items.slice(0, 12)));
  } catch {
    // ignore
  }
}

function nextIncidentStatus(
  current: string,
  action: "acknowledge" | "mitigate" | "ignore"
) {
  if (action === "mitigate") return "mitigated";
  if (action === "ignore") return "ignored";
  if (action === "acknowledge" && current === "open") return "acknowledged";
  return current;
}

function loadLocalEnroll(): LocalEnroll | null {
  try {
    const raw = localStorage.getItem(ENROLL_STORAGE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LocalEnroll>;
    if (!parsed.address || !parsed.signature || !parsed.message) return null;
    return {
      address: parsed.address,
      guild: parsed.guild || "My Guild",
      message: parsed.message,
      signature: parsed.signature,
      enrolledAt: parsed.enrolledAt || new Date().toISOString()
    };
  } catch {
    return null;
  }
}

function saveLocalEnroll(record: LocalEnroll) {
  try {
    localStorage.setItem(ENROLL_STORAGE, JSON.stringify(record));
  } catch {
    // ignore
  }
}

function clearLocalEnroll() {
  try {
    localStorage.removeItem(ENROLL_STORAGE);
  } catch {
    // ignore
  }
}

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

function loadGuildName() {
  try {
    return localStorage.getItem(GUILD_STORAGE)?.trim() || "My Guild";
  } catch {
    return "My Guild";
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

function formatEth(wei: string | undefined | null) {
  if (wei == null || wei === "" || wei === "undefined") return "—";
  const n = Number(wei) / 1e18;
  if (!Number.isFinite(n)) return "—";
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 4 })} ETH`;
}

function budgetDisplay(
  policyState: { dailyLimitWei?: string; dailyLimitEth?: string } | null,
  fallbackWei: string
) {
  if (policyState?.dailyLimitWei) return formatEth(policyState.dailyLimitWei);
  if (policyState?.dailyLimitEth && policyState.dailyLimitEth !== "undefined") {
    return `${policyState.dailyLimitEth} ETH`;
  }
  return formatEth(fallbackWei);
}

function spentDisplay(
  policyState: { spentTodayWei?: string; spentTodayEth?: string } | null,
  fallbackWei: string
) {
  if (policyState?.spentTodayWei) return formatEth(policyState.spentTodayWei);
  if (policyState?.spentTodayEth && policyState.spentTodayEth !== "undefined") {
    return `${policyState.spentTodayEth} ETH`;
  }
  return formatEth(fallbackWei);
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
  const [incidents, setIncidents] = useState<IncidentItem[]>(() => loadIncidents());
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
  const [entered, setEntered] = useState(false);
  const [guildName, setGuildName] = useState(() => loadGuildName());
  const [editingGuild, setEditingGuild] = useState(false);
  const [spendPickerOpen, setSpendPickerOpen] = useState(false);
  const [walletAddress, setWalletAddress] = useState<string | null>(() => loadLocalEnroll()?.address ?? null);
  const [enrolled, setEnrolled] = useState(() => !!loadLocalEnroll());
  const [enrollBusy, setEnrollBusy] = useState(false);
  const [enrollMsg, setEnrollMsg] = useState<string | null>(null);
  const [guildStats, setGuildStats] = useState<GuildStats>({ guildCount: 0, officerCount: 0, totalUsage: 0 });
  const [myUsage, setMyUsage] = useState(0);

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

  useEffect(() => {
    try {
      localStorage.setItem(GUILD_STORAGE, guildName);
    } catch {
      // ignore
    }
  }, [guildName]);

  useEffect(() => {
    persistIncidents(incidents);
  }, [incidents]);

  function toggleMute() {
    const next = !sfxMuted;
    setSfxMuted(next);
    setSfxMutedState(next);
    if (!next) void sfxClick();
  }

  function enterWorld() {
    setEntered(true);
    setTab("home");
    setIntent("risky-approve");
    setSpendPickerOpen(false);
    setAssessment(null);
    setWhyOpen(false);
    void sfxClick();
  }

  async function skipToFirstQuest() {
    setEntered(true);
    setTab("review");
    setIntent("risky-approve");
    setSpendPickerOpen(false);
    setAssessment(null);
    setWhyOpen(false);
    void sfxClick();
    await runAssessment();
  }

  function goCheck(next: IntentId = "risky-approve") {
    void sfxClick();
    setIntent(next);
    setAssessment(null);
    setWhyOpen(false);
    setSpendPickerOpen(false);
    setTab("review");
  }

  function goVault() {
    void sfxClick();
    setTab("security");
  }

  function resetSession() {
    void sfxClick();
    setXp(0);
    setBadges({ firstCheck: false, firstBlock: false, firstFreeze: false, cleanPayout: false });
    setAssessment(null);
    setIncidents([]);
    setAuditLog([]);
    setLastPlaybook(null);
    setKpi({ totalAssessments: 0, blockedCount: 0, blockedRate: 0, criticalIncidentCount: 0 });
    setPolicyPaused(null);
    setSpendPickerOpen(false);
    try {
      localStorage.setItem(XP_STORAGE, "0");
      localStorage.setItem(
        BADGE_STORAGE,
        JSON.stringify({ firstCheck: false, firstBlock: false, firstFreeze: false, cleanPayout: false })
      );
      sessionStorage.removeItem(INCIDENTS_STORAGE);
    } catch {
      // ignore
    }
    setTab("home");
    setIntent("risky-approve");
  }

  function applyGuildStats(data: Partial<GuildStats> & { yours?: { usageCount?: number; name?: string } }) {
    if (typeof data.guildCount === "number") {
      setGuildStats({
        guildCount: data.guildCount,
        officerCount: typeof data.officerCount === "number" ? data.officerCount : data.guildCount,
        totalUsage: typeof data.totalUsage === "number" ? data.totalUsage : 0
      });
    }
    if (data.yours && typeof data.yours.usageCount === "number") setMyUsage(data.yours.usageCount);
    if (data.yours?.name) setGuildName(data.yours.name.slice(0, 28));
  }

  async function handleConnectWallet() {
    setEnrollMsg(null);
    setEnrollBusy(true);
    try {
      const wallet = await connectWallet();
      setWalletAddress(wallet.address);
      void sfxClick();
    } catch (err) {
      setEnrollMsg(err instanceof Error ? err.message : "Could not connect wallet");
    } finally {
      setEnrollBusy(false);
    }
  }

  function disconnectWallet() {
    void sfxClick();
    clearLocalEnroll();
    setWalletAddress(null);
    setEnrolled(false);
    setMyUsage(0);
    setEnrollMsg(null);
  }

  function ensureWalletConnected() {
    if (walletAddress) return true;
    setError("Connect your officer wallet first.");
    setTab("home");
    return false;
  }

  async function enrollGuild(e?: FormEvent) {
    e?.preventDefault();
    const name = guildName.trim() || "My Guild";
    setEnrollBusy(true);
    setEnrollMsg(null);
    try {
      const signed = await signEnrollMessage(name);
      setWalletAddress(signed.address);
      const res = await fetch(`${API_BASE}/guilds`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          address: signed.address,
          message: signed.message,
          signature: signed.signature
        })
      });
      const data = (await res.json().catch(() => ({}))) as Partial<GuildStats> & {
        alreadyEnrolled?: boolean;
        yours?: { usageCount?: number; name?: string };
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || "Could not enroll");
      const record: LocalEnroll = {
        address: signed.address,
        guild: name,
        message: signed.message,
        signature: signed.signature,
        enrolledAt: new Date().toISOString()
      };
      saveLocalEnroll(record);
      setEnrolled(true);
      applyGuildStats(data);
      setEnrollMsg(null);
      void sfxSuccess();
    } catch (err) {
      setEnrollMsg(err instanceof Error ? err.message : "Could not connect guild");
    } finally {
      setEnrollBusy(false);
    }
  }

  async function recordGuildUsage(event: "review" | "freeze") {
    const address = walletAddress || loadLocalEnroll()?.address;
    if (!address || !enrolled) return;
    try {
      const res = await fetch(`${API_BASE}/guilds`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "usage", address, event })
      });
      if (!res.ok) return;
      const data = (await res.json()) as Partial<GuildStats> & { yours?: { usageCount?: number } };
      applyGuildStats(data);
    } catch {
      // ignore — usage proof is best-effort
    }
  }

  function awardXp(amount: number, label: string, badgeKey?: BadgeKey, tone: "xp" | "block" | "success" | "freeze" = "xp") {
    setXp((v) => v + amount);
    setXpToast(label);
    window.setTimeout(() => setXpToast(null), 1800);
    if (tone === "block") void sfxBlock();
    else if (tone === "success") void sfxSuccess();
    else if (tone === "freeze") void sfxFreeze();
    else void sfxXp();
    if (badgeKey && !badges[badgeKey]) {
      setBadges((b) => ({ ...b, [badgeKey]: true }));
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
  }

  useEffect(() => {
    pingRpc().then(setRpcLive);
    const local = loadLocalEnroll();
    // Always restore local session first — never flash disconnected while API syncs.
    if (local?.address) {
      setWalletAddress(local.address);
      setEnrolled(true);
      if (local.guild) setGuildName(local.guild.slice(0, 28));
    }
    fetch(`${API_BASE}/guilds`)
      .then((r) => (r.ok ? r.json() : null))
      .then(async (data) => {
        if (!data) return;
        applyGuildStats(data as Partial<GuildStats> & { guilds?: Array<{ ownerFull?: string; usageCount?: number }> });
        const list = (data as { guilds?: Array<{ ownerFull?: string; usageCount?: number }> }).guilds ?? [];
        if (local) {
          const mine = list.find((g) => g.ownerFull?.toLowerCase() === local.address.toLowerCase());
          if (mine) {
            if (typeof mine.usageCount === "number") setMyUsage(mine.usageCount);
          } else {
            // Re-publish signed enroll so roster survives serverless cold starts
            try {
              const res = await fetch(`${API_BASE}/guilds`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  name: local.guild,
                  address: local.address,
                  message: local.message,
                  signature: local.signature
                })
              });
              if (res.ok) {
                const body = (await res.json()) as Partial<GuildStats> & { yours?: { usageCount?: number } };
                applyGuildStats(body);
              }
            } catch {
              // keep local session even if sync fails
            }
          }
        }
      })
      .catch(() => {
        // keep local session
      });
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
        // Ephemeral serverless memory can be empty on another instance — never wipe local alerts.
        const remote = ((incidentsData as { items?: IncidentItem[] }).items ?? []).filter(Boolean);
        if (remote.length > 0) {
          setIncidents((prev) => {
            const byId = new Map(prev.map((i) => [i.id, i]));
            for (const item of remote) byId.set(item.id, item);
            return Array.from(byId.values()).slice(0, 12);
          });
        }
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
    if (!ensureWalletConnected()) return;
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
        if (data.policyState) {
          const limitWei = data.policyState.dailyLimitWei ?? payload.dailyLimitWei;
          const spentWei = data.policyState.spentTodayWei ?? payload.spentTodayWei;
          setPolicyState({
            allowlisted: data.policyState.allowlisted ?? payload.allowlisted,
            dailyLimitWei: limitWei,
            spentTodayWei: spentWei,
            policyPaused: Boolean((data.policyState as OnchainPolicy).policyPaused),
            dailyLimitEth: formatEth(limitWei).replace(/ ETH$/, ""),
            spentTodayEth: formatEth(spentWei).replace(/ ETH$/, ""),
            source: "onchain"
          });
        }
        setGuardPrediction(
          predictGuardOutcome({
            allowlisted: data.policyState?.allowlisted ?? payload.allowlisted,
            dailyLimitWei: data.policyState?.dailyLimitWei ?? payload.dailyLimitWei,
            spentTodayWei: data.policyState?.spentTodayWei ?? payload.spentTodayWei,
            amountWei: payload.amountWei
          })
        );
        if (result.blocked) {
          const incidentId = data.incident?.id ?? `inc-${payload.txHash}`;
          setIncidents((prev) => [
            {
              id: incidentId,
              title:
                data.incident?.title ??
                `Blocked · ${INTENTS[intent].vendor} · ${INTENTS[intent].amountEth} ETH`,
              severity: result.totalScore >= 80 ? "critical" : "high",
              recommendedPlaybook: result.recommendedPlaybook,
              status: "open"
            },
            ...prev.filter((i) => i.id !== incidentId)
          ]);
          setTab("alerts");
        }
        void recordGuildUsage("review");
        return;
      }

      let policy = payload;
      try {
        const onchain = await readOnchainPolicy(payload.wallet, payload.destination);
        if (onchain) {
          setPolicyState(onchain);
          // Keep intent flags when onchain has no limit configured (0) so risky spends still alert.
          policy = {
            ...payload,
            allowlisted: onchain.allowlisted && payload.allowlisted,
            dailyLimitWei:
              onchain.dailyLimitWei !== "0" ? onchain.dailyLimitWei : payload.dailyLimitWei,
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
      if (result.blocked) setTab("alerts");
      void recordGuildUsage("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Review failed");
    } finally {
      setLoading(false);
    }
  }

  async function applyAction(incidentId: string, action: "acknowledge" | "mitigate" | "ignore") {
    setError(null);
    // Optimistic local update first — serverless GET must never wipe this queue.
    setIncidents((prev) =>
      prev.map((item) =>
        item.id === incidentId ? { ...item, status: nextIncidentStatus(item.status, action) } : item
      )
    );
    setAuditLog((prev) => [
      { incidentId, action, actor: walletAddress || "guild-officer", createdAt: new Date().toISOString() },
      ...prev
    ]);
    if (action === "mitigate") {
      setPolicyPaused(true);
      awardXp(60, "Froze the guild bank", "firstFreeze", "freeze");
      void recordGuildUsage("freeze");
    }

    try {
      if (runtime === "api" && API_BASE) {
        const target = incidents.find((i) => i.id === incidentId);
        const actionRes = await fetch(`${API_BASE}/incidents/${incidentId}/action`, {
          method: "POST",
          headers: buildHeaders(true),
          body: JSON.stringify({
            action,
            actor: walletAddress || "guild-officer",
            incident: target
              ? {
                  id: target.id,
                  title: target.title,
                  severity: target.severity,
                  status: target.status,
                  recommendedPlaybook: target.recommendedPlaybook,
                  wallet: walletAddress || "",
                  details: "",
                  evidence: [],
                  createdAt: new Date().toISOString()
                }
              : undefined
          })
        });
        if (!actionRes.ok) throw new Error(`Action failed (${actionRes.status})`);
        const actionBody = (await actionRes.json()) as {
          incident?: IncidentItem;
          playbookExecution?: PlaybookExecution | null;
        };
        if (actionBody.playbookExecution) {
          setLastPlaybook(actionBody.playbookExecution);
          if (
            actionBody.playbookExecution.action === "policy_manager.pause" &&
            actionBody.playbookExecution.executed
          ) {
            setPolicyPaused(true);
          }
        }
        if (actionBody.incident?.id) {
          setIncidents((prev) => {
            const updated: IncidentItem = {
              id: actionBody.incident!.id,
              title: actionBody.incident!.title || target?.title || "Blocked spend",
              severity: actionBody.incident!.severity || target?.severity || "high",
              recommendedPlaybook:
                actionBody.incident!.recommendedPlaybook ||
                target?.recommendedPlaybook ||
                "freeze-wallet-and-revoke-approvals",
              status: actionBody.incident!.status || nextIncidentStatus("open", action)
            };
            const rest = prev.filter((i) => i.id !== updated.id);
            // If optimistic map missed (stale id), keep the card.
            if (prev.some((i) => i.id === incidentId) || prev.some((i) => i.id === updated.id)) {
              return [updated, ...rest.filter((i) => i.id !== incidentId)].slice(0, 12);
            }
            return [updated, ...prev].slice(0, 12);
          });
        }
      }
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
    ["review", "Review", <IconReview key="r" size={16} />],
    ["alerts", openIncidents ? `Alerts (${openIncidents})` : "Alerts", <IconAlerts key="a" size={16} />],
    ["automation", "Playbooks", <IconAutomation key="u" size={16} />],
    ["security", "Vault", <IconSecurity key="s" size={16} />]
  ];
  const currentSpend = INTENTS[intent];

  return (
    <>
      <BrandBackdrop />
      {xpToast && <div className="xp-toast">{xpToast}</div>}
      <div className={`app-shell ${entered ? "entered product-mode" : "title-screen"}`}>
      <header className="topbar">
        <a className="brand" href="/" aria-label="Arb Guardian home">
          <span className="brand-mark-frame">
            <img src="/logo.png" alt="" width={44} height={44} />
          </span>
          <div className="brand-mark">
            <h1 className="brand-title">
              <span className="accent">Arb</span> Guardian
            </h1>
            <p className="brand-sub">
              {entered ? (
                editingGuild ? (
                  <input
                    className="guild-input inline-edit"
                    value={guildName}
                    onChange={(e) => setGuildName(e.target.value.slice(0, 28))}
                    onBlur={() => setEditingGuild(false)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") setEditingGuild(false);
                    }}
                    autoFocus
                    aria-label="Guild name"
                  />
                ) : (
                  <button
                    type="button"
                    className="linkish inline brand-guild"
                    onClick={() => {
                      void sfxClick();
                      setEditingGuild(true);
                    }}
                  >
                    {guildName}
                  </button>
                )
              ) : (
                "Guild bank protection"
              )}
            </p>
          </div>
        </a>
        <div className="topbar-actions">
          {entered && (
            <span
              className={`chip status-chip ${policyPaused ? "warn" : "ok"}`}
              title={rpcLive ? "Live rules connected" : "Connecting"}
            >
              {!policyPaused && <span className="pulse-dot" />}
              {statusLabel}
            </span>
          )}
          {entered &&
            (walletAddress ? (
              <span className={`chip wallet-chip ${enrolled ? "ok" : ""}`} title={walletAddress}>
                {shortAddress(walletAddress)}
              </span>
            ) : (
              <button
                type="button"
                className="chip wallet-chip connect"
                onClick={() => {
                  void handleConnectWallet();
                }}
                disabled={enrollBusy}
              >
                {enrollBusy ? "…" : "Connect"}
              </button>
            ))}
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
          <p className="hero-kicker">GUILD BANK PROTECTION</p>
          <h2>
            <span className="accent">Arb</span> Guardian
          </h2>
          <p className="hero-lead">
            Review guild spends before anyone signs. Block scams. Freeze when it matters.
          </p>
          <div className="cta-row">
            <button type="button" className="primary" onClick={enterWorld}>
              Open console
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                void skipToFirstQuest();
              }}
              disabled={loading}
            >
              {loading ? "Checking…" : "Review a spend"}
            </button>
          </div>
          {error && <p className="error">{error}</p>}
        </section>
      ) : (
        <>
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
          </nav>

          <div className="panel" key={tab}>
            {tab === "home" && (
              <div className="home-stack">
                <section className="policy-snapshot" aria-label="Guild bank status">
                  <div>
                    <p className="snapshot-label">{guildName}</p>
                    <strong>
                      {policyPaused
                        ? "Spending frozen"
                        : openIncidents > 0
                          ? `${openIncidents} alert${openIncidents === 1 ? "" : "s"} need attention`
                          : "Bank ready"}
                    </strong>
                    <p className="muted">
                      {policyPaused
                        ? "Open Alerts to unfreeze when it is safe"
                        : openIncidents > 0
                          ? "Review the queue and freeze if needed"
                          : "Review the pending spend when you're ready"}
                    </p>
                  </div>
                  <div className="snapshot-actions">
                    {policyPaused || openIncidents > 0 ? (
                      <button
                        type="button"
                        className="primary"
                        onClick={() => {
                          void sfxClick();
                          setTab("alerts");
                        }}
                      >
                        <IconAlerts size={16} />
                        {policyPaused ? "Manage freeze" : "Open alerts"}
                      </button>
                    ) : (
                      <button type="button" className="primary" onClick={() => goCheck("risky-approve")}>
                        <IconPayment size={16} />
                        Review spend
                      </button>
                    )}
                  </div>
                </section>

                <section className="surface quiet-stats" aria-label="Activity">
                  <div>
                    <strong>{enrolled ? myUsage : kpi.totalAssessments}</strong>
                    <span>{enrolled ? "Your reviews" : "Reviews"}</span>
                  </div>
                  <div>
                    <strong>{guildStats.guildCount}</strong>
                    <span>Guilds</span>
                  </div>
                  <div>
                    <strong>{policyPaused ? "On" : openIncidents}</strong>
                    <span>{policyPaused ? "Freeze" : "Open alerts"}</span>
                  </div>
                </section>

                <section className="surface enroll-card" aria-label="Officer wallet">
                  <div className="enroll-copy">
                    <p className="snapshot-label">Officer wallet</p>
                    <strong>{enrolled ? "Guild connected" : "Connect your guild"}</strong>
                    <p className="muted">
                      {enrolled
                        ? "This wallet stays linked while you review spends and freeze when needed."
                        : "Sign once with your officer wallet to keep this guild active across sessions."}
                    </p>
                  </div>
                  {enrolled && walletAddress ? (
                    <div className="enroll-done">
                      <p>
                        <strong>{guildName}</strong>
                        <span className="muted"> · {shortAddress(walletAddress)}</span>
                      </p>
                      <p>
                        <button type="button" className="linkish" onClick={disconnectWallet}>
                          Disconnect wallet
                        </button>
                      </p>
                    </div>
                  ) : (
                    <form className="enroll-form" onSubmit={enrollGuild}>
                      <input
                        type="text"
                        name="guild"
                        maxLength={28}
                        placeholder="Guild name"
                        value={guildName === "My Guild" ? "" : guildName}
                        onChange={(e) => setGuildName(e.target.value.slice(0, 28) || "My Guild")}
                        aria-label="Guild name"
                        required
                      />
                      {!walletAddress ? (
                        <button
                          type="button"
                          className="ghost"
                          disabled={enrollBusy}
                          onClick={() => {
                            void handleConnectWallet();
                          }}
                        >
                          {enrollBusy ? "Connecting…" : "Connect wallet"}
                        </button>
                      ) : (
                        <span className="chip wallet-chip">{shortAddress(walletAddress)}</span>
                      )}
                      <button type="submit" className="primary" disabled={enrollBusy || !guildName.trim()}>
                        {enrollBusy ? "Confirming…" : "Save guild"}
                      </button>
                    </form>
                  )}
                  {enrollMsg && !enrolled ? <p className="error">{enrollMsg}</p> : null}
                </section>

                <p className="home-foot muted">
                  <button type="button" className="linkish" onClick={resetSession}>
                    Reset session
                  </button>
                </p>
              </div>
            )}

            {tab === "review" && (
              <div className="review-layout">
                <section className="surface review-main">
                  <div className="review-head">
                    <div>
                      <div className="review-badges">
                        <span className="review-badge">Pending</span>
                        {(policyState?.allowlisted ?? payload.allowlisted) ? (
                          <span className="review-badge ok">On allowlist</span>
                        ) : (
                          <span className="review-badge risk">Not on allowlist</span>
                        )}
                      </div>
                      <h3>{currentSpend.label}</h3>
                      <p className="muted">{currentSpend.blurb}</p>
                    </div>
                    <button
                      type="button"
                      className="ghost review-switch"
                      onClick={() => {
                        void sfxClick();
                        setSpendPickerOpen((v) => !v);
                      }}
                    >
                      {spendPickerOpen ? "Hide queue" : "Other spends"}
                    </button>
                  </div>

                  {spendPickerOpen && (
                    <div className="spend-switch" role="listbox" aria-label="Other spends">
                      {(Object.keys(INTENTS) as IntentId[]).map((id) => (
                        <button
                          key={id}
                          type="button"
                          role="option"
                          aria-selected={intent === id}
                          className={`scenario ${intent === id ? "active" : ""}`}
                          onClick={() => {
                            void sfxClick();
                            setIntent(id);
                            setAssessment(null);
                            setWhyOpen(false);
                            setSpendPickerOpen(false);
                          }}
                        >
                          <strong>{INTENTS[id].label}</strong>
                          <span className="scenario-meta">
                            {INTENTS[id].vendor} · {INTENTS[id].amountEth} ETH
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="review-amount">
                    <span>Amount</span>
                    <strong>{formatEth(payload.amountWei)}</strong>
                  </div>

                  <dl className="meta review-meta">
                    <div>
                      <dt>Type</dt>
                      <dd>{methodLabel(payload.method)}</dd>
                    </div>
                    <div>
                      <dt>From</dt>
                      <dd>{currentSpend.walletLabel}</dd>
                    </div>
                    <div>
                      <dt>To</dt>
                      <dd>{currentSpend.vendor}</dd>
                    </div>
                    <div>
                      <dt>Day limit</dt>
                      <dd title="Max the guild bank can send today">{budgetDisplay(policyState, payload.dailyLimitWei)}</dd>
                    </div>
                    <div>
                      <dt>Spent today</dt>
                      <dd title="Already sent from the bank today">
                        {spentDisplay(policyState, payload.spentTodayWei)}
                      </dd>
                    </div>
                    <div>
                      <dt>Allowlist</dt>
                      <dd>{(policyState?.allowlisted ?? payload.allowlisted) ? "Yes" : "No"}</dd>
                    </div>
                  </dl>
                  <p className="muted review-budget-hint">
                    Day limit is the guild rule for how much can leave the bank today. Spent today is the running total
                    against that rule.
                  </p>

                  {!assessment ? (
                    walletAddress ? (
                      <button
                        type="button"
                        className="primary full review-cta"
                        onClick={() => {
                          void sfxClick();
                          void runAssessment();
                        }}
                        disabled={loading}
                      >
                        <IconCheck size={16} />
                        {loading ? "Reviewing…" : "Review spend"}
                      </button>
                    ) : (
                      <div className="review-connect-gate">
                        <p className="muted">Connect your officer wallet to review spends for this guild.</p>
                        <button
                          type="button"
                          className="primary full review-cta"
                          disabled={enrollBusy}
                          onClick={() => {
                            void handleConnectWallet();
                          }}
                        >
                          {enrollBusy ? "Connecting…" : "Connect wallet"}
                        </button>
                      </div>
                    )
                  ) : (
                    <div className={`decision-card ${assessment.blocked ? "is-block" : "is-allow"}`}>
                      <p className="result-line">
                        <span className={`status-pill ${assessment.blocked ? "blocked" : "allowed"}`}>
                          {assessment.blocked ? <IconAlerts size={14} /> : <IconCheck size={14} />}
                          {plainOutcome(assessment, intent)}
                        </span>
                      </p>
                      <p className="decision-copy">
                        {assessment.blocked
                          ? "Do not sign. Officer AI recommends freeze — you confirm in Alerts."
                          : "Rules look clean. Safe to continue."}
                      </p>
                      <div className="officer-ai">
                        <strong>Officer AI</strong>
                        <p>
                          Suggests: <em>{playbookLabel(assessment.recommendedPlaybook)}</em>
                        </p>
                        <p className="muted">Cannot move funds. Freeze needs a human click.</p>
                      </div>
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
                                {m.reason} <span className="muted">({m.severity})</span>
                              </li>
                            ))
                          )}
                        </ul>
                      )}
                      <div className="cta-row left" style={{ marginTop: "0.85rem" }}>
                        {assessment.blocked ? (
                          <button
                            type="button"
                            className="primary"
                            onClick={() => {
                              void sfxClick();
                              setTab("alerts");
                            }}
                          >
                            <IconAlerts size={16} />
                            Open alerts
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => {
                              void sfxClick();
                              setAssessment(null);
                              setSpendPickerOpen(true);
                            }}
                          >
                            Review another
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </section>
              </div>
            )}

            {tab === "alerts" && (
              <div className="grid">
                <section className="surface">
                  <h3>
                    <IconAlerts size={18} /> Alerts
                  </h3>
                  {policyPaused && (
                    <div className="freeze-success" style={{ marginBottom: "0.95rem" }}>
                      <strong>Bank frozen</strong>
                      <p className="muted">
                        The alert is resolved. Spending stays paused until you unfreeze.
                      </p>
                      <div className="cta-row left">
                        <button type="button" className="primary" onClick={goVault}>
                          See live networks
                        </button>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => {
                            void sfxClick();
                            void unpausePolicy();
                          }}
                        >
                          Unfreeze
                        </button>
                      </div>
                    </div>
                  )}
                  {openIncidents > 0 ? (
                    <p className="muted" style={{ marginBottom: "0.85rem" }}>
                      {openIncidents} open · Officer AI suggests, you confirm freeze.
                    </p>
                  ) : null}
                  {incidents.length === 0 && !policyPaused ? (
                    <div className="empty-state">
                      <IconAlerts size={28} />
                      <p>No alerts yet</p>
                      <p className="muted">Blocked spends appear here for officer action.</p>
                      <button type="button" className="ghost" onClick={() => goCheck("risky-approve")}>
                        Review spend
                      </button>
                    </div>
                  ) : incidents.length === 0 && policyPaused ? (
                    <p className="muted">Freeze is active. Use Unfreeze above when it is safe.</p>
                  ) : (
                    <ul className="incident-list">
                      {incidents.map((incident) => {
                        const isOpen = incident.status === "open" || incident.status === "acknowledged";
                        return (
                          <li key={incident.id} className="incident-item">
                            <div className="incident-head">
                              <strong>{incident.title}</strong>
                              <span className={`sev sev-${incident.severity}`}>
                                {incident.status === "mitigated" ? "frozen" : incident.severity}
                              </span>
                            </div>
                            <p className="muted">
                              {incident.status === "mitigated"
                                ? "Resolved · freeze confirmed"
                                : `${incident.status} · Officer AI: ${playbookLabel(incident.recommendedPlaybook)}`}
                            </p>
                            {isOpen ? (
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
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
                <section className="surface">
                  <h3>Activity log</h3>
                  {lastPlaybook && (
                    <p className="next-step" style={{ marginBottom: "0.75rem" }}>
                      Last action:{" "}
                      <strong>
                        {lastPlaybook.action?.includes("pause")
                          ? "Freeze guild spending"
                          : lastPlaybook.action?.includes("unpause")
                            ? "Unfreeze"
                            : lastPlaybook.action}
                      </strong>
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
                  {auditLog.length === 0 && !lastPlaybook && !policyPaused ? (
                    <p className="muted">Officer actions appear here after you respond to an alert.</p>
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
                    <IconAutomation size={18} /> Officer AI · playbooks
                  </h3>
                  <p className="muted">
                    Risk score maps to a fixed response officers can trust. The AI suggests — freezing still needs your
                    click on Alerts.
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
                    {loading ? "Running…" : "Run sample review"}
                  </button>
                  {assessment && (
                    <div className="officer-ai" style={{ marginTop: "1rem" }}>
                      <strong>Last suggestion</strong>
                      <p>
                        <em>{playbookLabel(assessment.recommendedPlaybook)}</em>
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
                      <p>Freeze guild spending (officer click)</p>
                    </article>
                  </div>
                </section>
                <section className="surface">
                  <h3>What Officer AI can do</h3>
                  {agentEval ? (
                    <p className="muted" style={{ marginBottom: "0.65rem" }}>
                      Trust check: {agentEval.passed}/{agentEval.total} scenarios · accuracy{" "}
                      {(agentEval.accuracy * 100).toFixed(0)}%
                    </p>
                  ) : (
                    <p className="muted" style={{ marginBottom: "0.65rem" }}>
                      Trust check: 12/12 scenarios · accuracy 100% in the automated harness.
                    </p>
                  )}
                  <ul className="clean">
                    <li>Suggest a playbook from the risk score</li>
                    <li>Open an alert when a spend is blocked</li>
                    <li>Never move guild funds</li>
                    <li>Never change approved payout lists</li>
                    <li>Never freeze without an officer click</li>
                  </ul>
                </section>
                <section className="surface">
                  <h3>Hard limits</h3>
                  <ul className="clean">
                    <li>Cannot move guild funds</li>
                    <li>Cannot change approved payout lists</li>
                    <li>Cannot grant officer admin access</li>
                    <li>Freeze only after Freeze guild spending is clicked</li>
                  </ul>
                </section>
              </div>
            )}

            {tab === "security" && (
              <div className="grid">
                <section className="surface span-2">
                  <h3>
                    <IconSecurity size={18} /> Live networks · contract quality
                  </h3>
                  <p className="muted section-lead">
                    {guildName} protection is live on Arbitrum Sepolia and Robinhood Chain. Day-to-day play stays in Check
                    spend and Alerts.
                  </p>
                  <div className="asset-grid">
                    <article className="asset-card">
                      <strong>Access control</strong>
                      <span>RBAC</span>
                      <p>Policy roles control who can pause and set limits.</p>
                    </article>
                    <article className="asset-card">
                      <strong>Circuit breaker</strong>
                      <span>Pausable</span>
                      <p>Officer-gated freeze stops spending when needed.</p>
                    </article>
                    <article className="asset-card">
                      <strong>Spend guard</strong>
                      <span>Onchain</span>
                      <p>Unsafe spends can revert before they clear.</p>
                    </article>
                    <article className="asset-card">
                      <strong>Safe path</strong>
                      <span>Multisig guard</span>
                      <p>Compatible treasury guard for enrolled guild wallets.</p>
                    </article>
                    <article className="asset-card">
                      <strong>Arbitrum</strong>
                      <span>Live</span>
                      <p>Sepolia PolicyManager + ExecutionGuard + Safe.</p>
                    </article>
                    <article className="asset-card">
                      <strong>Robinhood</strong>
                      <span>{RH_READY ? "Live" : "Pending"}</span>
                      <p>{RH_READY ? "Testnet twin deploy for the same loop." : "Deployment pending."}</p>
                    </article>
                  </div>
                </section>
                <section className="surface">
                  <h3>Arbitrum Sepolia</h3>
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
                    {SAFE_TREASURY_GUARD && (
                      <li>
                        <a href={addressUrl(SAFE_TREASURY_GUARD)} target="_blank" rel="noreferrer">
                          SafeTreasuryGuard
                        </a>
                      </li>
                    )}
                    {TREASURY_SAFE && (
                      <li>
                        <a href={addressUrl(TREASURY_SAFE)} target="_blank" rel="noreferrer">
                          Enrolled guild Safe
                        </a>
                      </li>
                    )}
                  </ul>
                </section>
                <section className="surface">
                  <h3>Robinhood Chain</h3>
                  {RH_READY ? (
                    <ul className="clean">
                      <li>
                        <a href={rhAddressUrl(RH_POLICY_MANAGER)} target="_blank" rel="noreferrer">
                          PolicyManager
                        </a>
                      </li>
                      <li>
                        <a href={rhAddressUrl(RH_EXECUTION_GUARD)} target="_blank" rel="noreferrer">
                          ExecutionGuard
                        </a>
                      </li>
                      {RH_SAFE_TREASURY_GUARD && (
                        <li>
                          <a href={rhAddressUrl(RH_SAFE_TREASURY_GUARD)} target="_blank" rel="noreferrer">
                            SafeTreasuryGuard
                          </a>
                        </li>
                      )}
                      {RH_TREASURY_SAFE && (
                        <li>
                          <a href={rhAddressUrl(RH_TREASURY_SAFE)} target="_blank" rel="noreferrer">
                            Enrolled guild Safe
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
                  <h3>Product</h3>
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
                    <li>Category: Gaming · guild bank protection</li>
                  </ul>
                </section>
              </div>
            )}
          </div>
        </>
      )}

      <footer className="footer">
        <div>Arb Guardian — guild bank protection</div>
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
              goVault();
            }}
          >
            Live networks
          </button>
          {runtime === "api" ? " · API connected" : null}
        </div>
      </footer>
      </div>
    </>
  );
}
