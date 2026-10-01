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
import { guardProof, shortDigest } from "./guardProof";
import { driftReport } from "./deployedDrift";
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
  treasury: string;
  message: string;
  signature: string;
  enrolledAt: string;
};

type TreasuryStats = {
  treasuryCount: number;
  operatorCount: number;
  totalUsage: number;
};

const XP_STORAGE = "arb-guardian-xp-v1";
const BADGE_STORAGE = "arb-guardian-badges-v1";
const TREASURY_STORAGE = "arb-guardian-treasury-v1";
const ENROLL_STORAGE = "arb-guardian-treasury-enroll-v1";
const INCIDENTS_STORAGE = "arb-guardian-incidents-v1";
const INTEREST_STORAGE = "arb-guardian-interest-v1";

/**
 * Keys and default names written before the repositioning, when a treasury was called a
 * "guild". Read once so a returning visitor keeps their name and signed enrollment, then gone.
 */
const LEGACY_TREASURY_STORAGE = "arb-guardian-guild-v1";
const LEGACY_ENROLL_STORAGE = "arb-guardian-guild-enroll-v1";
const LEGACY_DEFAULT_NAME = "My Guild";

function readStored(current: string, legacy: string) {
  try {
    return localStorage.getItem(current) ?? localStorage.getItem(legacy);
  } catch {
    return null;
  }
}

function loadInterestJoined() {
  try {
    return localStorage.getItem(INTEREST_STORAGE) === "1";
  } catch {
    return false;
  }
}

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
    const raw = readStored(ENROLL_STORAGE, LEGACY_ENROLL_STORAGE);
    if (!raw) return null;
    // `guild` is the pre-repositioning field name; keep reading it so old sessions survive.
    const parsed = JSON.parse(raw) as Partial<LocalEnroll> & { guild?: string };
    if (!parsed.address || !parsed.signature || !parsed.message) return null;
    return {
      address: parsed.address,
      treasury: parsed.treasury || parsed.guild || "My Treasury",
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
    localStorage.removeItem(LEGACY_ENROLL_STORAGE);
  } catch {
    // ignore
  }
}

function clearLocalEnroll() {
  try {
    localStorage.removeItem(ENROLL_STORAGE);
    localStorage.removeItem(LEGACY_ENROLL_STORAGE);
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

function loadTreasuryName() {
  try {
    const stored = readStored(TREASURY_STORAGE, LEGACY_TREASURY_STORAGE)?.trim();
    // Both the pre-repositioning default and ours mean "unset".
    if (!stored || stored === LEGACY_DEFAULT_NAME || stored === "My Treasury") return "My Treasury";
    return stored;
  } catch {
    return "My Treasury";
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
  // Policy conformance across fixed regression fixtures. Not model validation.
  conformanceRate: number;
  blockedPrecision: number;
  blockedRecall: number;
};

type IntentId = "risky-approve" | "limit-breach" | "safe-transfer";
type TabId = "home" | "review" | "alerts" | "automation" | "security";

/** The evidence pack writes an ISO timestamp; render it without the millisecond noise. */
const PROOF_GENERATED_AT = guardProof.generatedAt.replace("T", " ").replace(/\.\d+Z$/, " UTC");
const DRIFT_GENERATED_AT = driftReport.generatedAt.replace("T", " ").replace(/\.\d+Z$/, " UTC");
const PROOF_SAFE_VERSION = guardProof.safeVersion.split(" ")[0];

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
    label: "Agent asks for standing approval",
    blurb: "A delegate asks for permission to pull money from the treasury, from an address nobody has allowlisted",
    outcomeHint: "unlimited approval",
    vendor: "Unlisted address",
    walletLabel: "Operator key A",
    amountEth: "1.00",
    whyUsersCare: "One bad approval is how a bounded budget turns into an unbounded one",
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
    label: "Over today's spend limit",
    blurb: "Paying an allowlisted vendor, but the amount is bigger than the cap policy set",
    outcomeHint: "over today's limit",
    vendor: "Contributor payouts (approved)",
    walletLabel: "Operator key B",
    amountEth: "4.00",
    whyUsersCare: "Payroll and vendor runs stay inside the ceiling whether or not the delegate respects it",
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
    label: "Normal vendor payout",
    blurb: "Paying an allowlisted vendor, inside today's limit",
    outcomeHint: "within policy",
    vendor: "Contributor payouts (approved)",
    walletLabel: "Operator key C",
    amountEth: "1.00",
    whyUsersCare: "Routine payouts keep moving without a human in the loop",
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
  [TREASURY.a]: "Operator key A",
  [TREASURY.b]: "Operator key B",
  [TREASURY.c]: "Operator key C"
};

const PLAYBOOK_LABELS: Record<string, string> = {
  "freeze-wallet-and-revoke-approvals": "Freeze the treasury account",
  "hold-transaction-and-require-admin-review": "Hold for an admin review",
  "request-secondary-signer-confirmation": "Ask a second signer",
  "allow-with-monitoring": "Allow and keep watching"
};

function playbookLabel(id: string) {
  return PLAYBOOK_LABELS[id] ?? id.replace(/-/g, " ");
}

function plainOutcome(assessment: RiskAssessment, intentId: IntentId) {
  if (!assessment.blocked) return "Allow — within policy";
  const hint = INTENTS[intentId].outcomeHint;
  if (assessment.totalScore >= 80) return `Block — ${hint}`;
  return `Hold — ${hint}`;
}

function methodLabel(method: string) {
  if (method === "approve") return "Permission to spend";
  if (method === "transfer") return "Vendor payout";
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
  const [badges, setBadges] = useState<BadgeState>(() => loadBadges());
  const [sfxMuted, setSfxMutedState] = useState(() => loadSfxMuted());
  const [entered, setEntered] = useState(false);
  const [treasuryName, setTreasuryName] = useState(() => loadTreasuryName());
  const [editingTreasury, setEditingTreasury] = useState(false);
  const [spendPickerOpen, setSpendPickerOpen] = useState(false);
  const [walletAddress, setWalletAddress] = useState<string | null>(() => loadLocalEnroll()?.address ?? null);
  const [enrolled, setEnrolled] = useState(() => !!loadLocalEnroll());
  const [enrollBusy, setEnrollBusy] = useState(false);
  const [enrollMsg, setEnrollMsg] = useState<string | null>(null);
  const [treasuryStats, setTreasuryStats] = useState<TreasuryStats>({ treasuryCount: 0, operatorCount: 0, totalUsage: 0 });
  const [myUsage, setMyUsage] = useState(0);
  const [interestJoined, setInterestJoined] = useState(() => loadInterestJoined());
  const [interestEmail, setInterestEmail] = useState("");
  const [interestCount, setInterestCount] = useState(0);
  const [interestBusy, setInterestBusy] = useState(false);
  const [interestMsg, setInterestMsg] = useState<string | null>(null);
  const [operatorOpen, setOperatorOpen] = useState(false);

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
      localStorage.setItem(TREASURY_STORAGE, treasuryName);
    } catch {
      // ignore
    }
  }, [treasuryName]);

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

  function applyTreasuryStats(data: Partial<TreasuryStats> & { yours?: { usageCount?: number; name?: string } }) {
    if (typeof data.treasuryCount === "number") {
      setTreasuryStats({
        treasuryCount: data.treasuryCount,
        operatorCount: typeof data.operatorCount === "number" ? data.operatorCount : data.treasuryCount,
        totalUsage: typeof data.totalUsage === "number" ? data.totalUsage : 0
      });
    }
    if (data.yours && typeof data.yours.usageCount === "number") setMyUsage(data.yours.usageCount);
    if (data.yours?.name) setTreasuryName(data.yours.name.slice(0, 28));
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

  async function joinInterest(e: FormEvent) {
    e.preventDefault();
    const email = interestEmail.trim().toLowerCase();
    if (!email.includes("@") || email.length < 5) {
      setInterestMsg("Enter a real email.");
      return;
    }
    setInterestBusy(true);
    setInterestMsg(null);
    try {
      const res = await fetch(`${API_BASE}/waitlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, treasury: treasuryName.trim() || "Treasury" })
      });
      const data = (await res.json().catch(() => ({}))) as {
        count?: number;
        alreadyJoined?: boolean;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || "Could not save");
      setInterestJoined(true);
      if (typeof data.count === "number") setInterestCount(data.count);
      setInterestMsg(data.alreadyJoined ? "You're already on the list." : "You're on the list.");
      try {
        localStorage.setItem(INTEREST_STORAGE, "1");
        localStorage.setItem(`${INTEREST_STORAGE}:email`, email);
        localStorage.setItem(`${INTEREST_STORAGE}:treasury`, treasuryName.trim() || "Treasury");
      } catch {
        // ignore
      }
      void sfxSuccess();
    } catch (err) {
      setInterestMsg(err instanceof Error ? err.message : "Could not save. Try again.");
    } finally {
      setInterestBusy(false);
    }
  }

  async function enrollTreasury(e?: FormEvent) {
    e?.preventDefault();
    const name = treasuryName.trim() || "My Treasury";
    setEnrollBusy(true);
    setEnrollMsg(null);
    try {
      const signed = await signEnrollMessage(name);
      setWalletAddress(signed.address);
      const res = await fetch(`${API_BASE}/treasurys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          address: signed.address,
          message: signed.message,
          signature: signed.signature
        })
      });
      const data = (await res.json().catch(() => ({}))) as Partial<TreasuryStats> & {
        alreadyEnrolled?: boolean;
        yours?: { usageCount?: number; name?: string };
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || "Could not enroll");
      const record: LocalEnroll = {
        address: signed.address,
        treasury: name,
        message: signed.message,
        signature: signed.signature,
        enrolledAt: new Date().toISOString()
      };
      saveLocalEnroll(record);
      setEnrolled(true);
      applyTreasuryStats(data);
      setEnrollMsg(null);
      void sfxSuccess();
    } catch (err) {
      setEnrollMsg(err instanceof Error ? err.message : "Could not load policy state");
    } finally {
      setEnrollBusy(false);
    }
  }

  async function recordTreasuryUsage(event: "review" | "freeze") {
    const address = walletAddress || loadLocalEnroll()?.address;
    if (!address || !enrolled) return;
    try {
      const res = await fetch(`${API_BASE}/treasurys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "usage", address, event })
      });
      if (!res.ok) return;
      const data = (await res.json()) as Partial<TreasuryStats> & { yours?: { usageCount?: number } };
      applyTreasuryStats(data);
    } catch {
      // ignore — usage proof is best-effort
    }
  }

  function awardXp(amount: number, _label: string, badgeKey?: BadgeKey, tone: "xp" | "block" | "success" | "freeze" = "xp") {
    setXp((v) => v + amount);
    // No toast chrome in product mode — keep subtle sound only.
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
      else awardXp(15, "Policy check", "firstCheck", "success");
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
      if (local.treasury) setTreasuryName(local.treasury.slice(0, 28));
    }
    fetch(`${API_BASE}/treasurys`)
      .then((r) => (r.ok ? r.json() : null))
      .then(async (data) => {
        if (!data) return;
        applyTreasuryStats(data as Partial<TreasuryStats> & { treasurys?: Array<{ ownerFull?: string; usageCount?: number }> });
        const list = (data as { treasurys?: Array<{ ownerFull?: string; usageCount?: number }> }).treasurys ?? [];
        if (local) {
          const mine = list.find((g) => g.ownerFull?.toLowerCase() === local.address.toLowerCase());
          if (mine) {
            if (typeof mine.usageCount === "number") setMyUsage(mine.usageCount);
          } else {
            // Re-publish signed enroll so roster survives serverless cold starts
            try {
              const res = await fetch(`${API_BASE}/treasurys`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  name: local.treasury,
                  address: local.address,
                  message: local.message,
                  signature: local.signature
                })
              });
              if (res.ok) {
                const body = (await res.json()) as Partial<TreasuryStats> & { yours?: { usageCount?: number } };
                applyTreasuryStats(body);
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
    fetch(`${API_BASE}/waitlist`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && typeof data.count === "number") setInterestCount(data.count);
      })
      .catch(() => {
        // ignore
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
        if (evalData?.summary) {
          // Accept the legacy `accuracy` field too, so deploying the web app before the API
          // route cannot render a NaN percentage.
          const summary = evalData.summary as Partial<AgentEvalSummary> & { accuracy?: number };
          setAgentEval({
            total: summary.total ?? 0,
            passed: summary.passed ?? 0,
            conformanceRate: summary.conformanceRate ?? summary.accuracy ?? 0,
            blockedPrecision: summary.blockedPrecision ?? 0,
            blockedRecall: summary.blockedRecall ?? 0
          });
        }
        if (policyData && typeof policyData.paused === "boolean") setPolicyPaused(policyData.paused);
      })
      .catch(() => setRuntime("onchain-console"));
  }, []);

  async function runAssessment() {
    // Anyone can check a spend to learn the risk. Wallet only required to count operator usage.
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
          result.blocked ? "Blocked a drain attempt" : intent === "safe-transfer" ? "Clean payout" : "Policy check",
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
        void recordTreasuryUsage("review");
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
      void recordTreasuryUsage("review");
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
      { incidentId, action, actor: walletAddress || "operator", createdAt: new Date().toISOString() },
      ...prev
    ]);
    if (action === "mitigate") {
      setPolicyPaused(true);
      awardXp(60, "Froze the treasury", "firstFreeze", "freeze");
      void recordTreasuryUsage("freeze");
    }

    try {
      if (runtime === "api" && API_BASE) {
        const target = incidents.find((i) => i.id === incidentId);
        const actionRes = await fetch(`${API_BASE}/incidents/${incidentId}/action`, {
          method: "POST",
          headers: buildHeaders(true),
          body: JSON.stringify({
            action,
            actor: walletAddress || "operator",
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
                editingTreasury ? (
                  <input
                    className="treasury-input inline-edit"
                    value={treasuryName}
                    onChange={(e) => setTreasuryName(e.target.value.slice(0, 28))}
                    onBlur={() => setEditingTreasury(false)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") setEditingTreasury(false);
                    }}
                    autoFocus
                    aria-label="Treasury name"
                  />
                ) : (
                  <button
                    type="button"
                    className="linkish inline brand-treasury"
                    onClick={() => {
                      void sfxClick();
                      setEditingTreasury(true);
                    }}
                  >
                    {treasuryName}
                  </button>
                )
              ) : (
                "Enforceable spend policy"
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
          <p className="hero-kicker">ENFORCEABLE SPEND POLICY</p>
          <h2>
            <span className="accent">Arb</span> Guardian
          </h2>
          <p className="hero-lead">
            Give an agent, bot or operator money without giving it the ability to drain the account. Check the spend
            before it clears — and lock the treasury when it looks wrong.
          </p>
          <div className="cta-row">
            <button type="button" className="primary" onClick={enterWorld}>
              Open
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                void skipToFirstQuest();
              }}
              disabled={loading}
            >
              {loading ? "Checking…" : "See a risky spend"}
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
                <section className="policy-snapshot" aria-label="Treasury policy status">
                  <div>
                    <p className="snapshot-label">{treasuryName === "My Treasury" ? "Your treasury" : treasuryName}</p>
                    <strong>
                      {policyPaused
                        ? "Bank locked"
                        : openIncidents > 0
                          ? `${openIncidents} alert${openIncidents === 1 ? "" : "s"} need a decision`
                          : "Ready to check a spend"}
                    </strong>
                    <p className="muted">
                      {policyPaused
                        ? "Unlock from Alerts when it is safe"
                        : openIncidents > 0
                          ? "Open Alerts to lock the treasury or dismiss"
                          : "See if a spend is safe before anyone approves it"}
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
                        {policyPaused ? "Manage lock" : "Open alerts"}
                      </button>
                    ) : (
                      <button type="button" className="primary" onClick={() => goCheck("risky-approve")}>
                        <IconPayment size={16} />
                        Check a spend
                      </button>
                    )}
                  </div>
                </section>

                {(interestCount > 0 || treasuryStats.treasuryCount > 0 || (enrolled ? myUsage : kpi.totalAssessments) > 0) && (
                  <section className="surface quiet-stats" aria-label="Activity">
                    {interestCount > 0 ? (
                      <div>
                        <strong>{interestCount}</strong>
                        <span>Teams interested</span>
                      </div>
                    ) : null}
                    {treasuryStats.treasuryCount > 0 ? (
                      <div>
                        <strong>{treasuryStats.treasuryCount}</strong>
                        <span>Operators linked</span>
                      </div>
                    ) : null}
                    <div>
                      <strong>{enrolled ? myUsage : kpi.totalAssessments}</strong>
                      <span>{enrolled ? "Your checks" : "Checks"}</span>
                    </div>
                  </section>
                )}

                <section className="surface enroll-card" aria-label="Join the pilot">
                  <div className="enroll-copy">
                    <p className="snapshot-label">For teams</p>
                    <strong>{interestJoined ? "You're on the list" : "Join with email — no wallet"}</strong>
                    <p className="muted">
                      Treasury owners and operators: leave your treasury name and email. We'll follow up when enroll opens.
                    </p>
                  </div>
                  {interestJoined ? (
                    <div className="enroll-done">
                      <p>
                        <strong>{interestMsg || "Thanks — you're on the list."}</strong>
                      </p>
                      <p>
                        <button
                          type="button"
                          className="linkish"
                          onClick={async () => {
                            const text =
                              "Arb Guardian gives an agent, bot or operator money without giving it the ability to drain the account. Join the list (no wallet needed): https://arb-guardian.vercel.app";
                            try {
                              await navigator.clipboard.writeText(text);
                              setInterestMsg("Invite link copied.");
                              void sfxSuccess();
                            } catch {
                              setInterestMsg("Copy failed — share arb-guardian.vercel.app");
                            }
                          }}
                        >
                          Copy invite for your team
                        </button>
                      </p>
                    </div>
                  ) : (
                    <form className="enroll-form" onSubmit={joinInterest}>
                      <input
                        type="text"
                        name="treasury"
                        maxLength={28}
                        placeholder="Treasury name"
                        value={treasuryName === "My Treasury" ? "" : treasuryName}
                        onChange={(e) => setTreasuryName(e.target.value.slice(0, 28) || "My Treasury")}
                        aria-label="Treasury name"
                      />
                      <input
                        type="email"
                        name="email"
                        autoComplete="email"
                        placeholder="you@team.gg"
                        value={interestEmail}
                        onChange={(e) => setInterestEmail(e.target.value)}
                        aria-label="Email"
                        required
                      />
                      <button type="submit" className="primary" disabled={interestBusy}>
                        {interestBusy ? "Saving…" : "Join list"}
                      </button>
                    </form>
                  )}
                  {interestMsg && !interestJoined ? <p className="error">{interestMsg}</p> : null}
                </section>

                <section className="surface enroll-card operator-card" aria-label="Operator wallet">
                  {enrolled && walletAddress ? (
                    <>
                      <div className="enroll-copy">
                        <p className="snapshot-label">Operator</p>
                        <strong>Wallet linked</strong>
                        <p className="muted">You can check spends and freeze the treasury.</p>
                      </div>
                      <div className="enroll-done">
                        <p>
                          <strong>{treasuryName}</strong>
                          <span className="muted"> · {shortAddress(walletAddress)}</span>
                        </p>
                        <p>
                          <button type="button" className="linkish" onClick={disconnectWallet}>
                            Disconnect wallet
                          </button>
                        </p>
                      </div>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="operator-toggle linkish"
                        onClick={() => {
                          void sfxClick();
                          setOperatorOpen((v) => !v);
                        }}
                      >
                        {operatorOpen ? "Hide operator wallet" : "I'm an operator — connect wallet"}
                      </button>
                      {operatorOpen ? (
                        <>
                          <p className="muted" style={{ margin: 0 }}>
                            Optional. Link once so checks and freezes count for your treasury.
                          </p>
                          <form className="enroll-form" onSubmit={enrollTreasury}>
                            <input
                              type="text"
                              name="treasury-operator"
                              maxLength={28}
                              placeholder="Treasury name"
                              value={treasuryName === "My Treasury" ? "" : treasuryName}
                              onChange={(e) => setTreasuryName(e.target.value.slice(0, 28) || "My Treasury")}
                              aria-label="Treasury name"
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
                            <button type="submit" className="primary" disabled={enrollBusy || !treasuryName.trim()}>
                              {enrollBusy ? "Confirming…" : "Save name"}
                            </button>
                          </form>
                          {enrollMsg ? <p className="error">{enrollMsg}</p> : null}
                        </>
                      ) : null}
                    </>
                  )}
                </section>
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
                          <span className="review-badge ok">Trusted payee</span>
                        ) : (
                          <span className="review-badge risk">Unknown payee</span>
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
                      <dd title="Max the treasury can send today">{budgetDisplay(policyState, payload.dailyLimitWei)}</dd>
                    </div>
                    <div>
                      <dt>Spent today</dt>
                      <dd title="Already sent from the treasury today">
                        {spentDisplay(policyState, payload.spentTodayWei)}
                      </dd>
                    </div>
                    <div>
                      <dt>Trusted list</dt>
                      <dd>{(policyState?.allowlisted ?? payload.allowlisted) ? "Yes" : "No"}</dd>
                    </div>
                  </dl>
                  <p className="muted review-budget-hint">
                    Day limit = max the treasury can send today. Spent today = already used. Unknown payee = not on the
                    trusted list.
                  </p>

                  {!assessment ? (
                    <div className="review-connect-gate">
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
                        {loading ? "Checking…" : "Check this spend"}
                      </button>
                      {!walletAddress ? (
                        <p className="muted">
                          No wallet needed to understand the risk. Operators can{" "}
                          <button
                            type="button"
                            className="linkish"
                            onClick={() => {
                              void handleConnectWallet();
                            }}
                          >
                            connect
                          </button>{" "}
                          later to freeze the treasury.
                        </p>
                      ) : null}
                    </div>
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
                          ? "Do not approve this. The policy helper suggests freezing the treasury — a human must confirm in Alerts."
                          : "Looks clean. Within policy. You can approve this."}
                      </p>
                      <div className="operator-ai">
                        <strong>Policy helper</strong>
                        <p>
                          Suggests: <em>{playbookLabel(assessment.recommendedPlaybook)}</em>
                        </p>
                        <p className="muted">Cannot move money. Freezing the treasury needs your click.</p>
                      </div>
                      <button type="button" className="linkish" onClick={() => setWhyOpen((v) => !v)}>
                        {whyOpen ? "Hide details" : "Why this decision"}
                      </button>
                      {whyOpen && (
                        <ul className="clean why-list">
                          {assessment.matches.length === 0 ? (
                            <li>No rule flags — destination and amount are inside treasury limits.</li>
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
                      <strong>Treasury frozen</strong>
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
                      {openIncidents} open · The policy helper suggests, you confirm the freeze.
                    </p>
                  ) : null}
                  {incidents.length === 0 && !policyPaused ? (
                    <div className="empty-state">
                      <IconAlerts size={28} />
                      <p>No alerts yet</p>
                      <p className="muted">Blocked spends appear here for operator action.</p>
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
                                : `${incident.status} · Helper: ${playbookLabel(incident.recommendedPlaybook)}`}
                            </p>
                            {isOpen ? (
                              <div className="actions">
                                <button
                                  type="button"
                                  className="primary"
                                  onClick={() => {
                                    void sfxClick();
                                    void applyAction(incident.id, "mitigate");
                                  }}
                                >
                                  <IconFreeze size={14} />
                                  Freeze the treasury
                                </button>
                                <button
                                  type="button"
                                  className="ghost"
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
                          ? "Freeze the treasury"
                          : lastPlaybook.action?.includes("unpause")
                            ? "Unfreeze the treasury"
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
                    <p className="muted">Operator actions appear here after you respond to an alert.</p>
                  ) : (
                    <ul className="clean">
                      {auditLog.slice(0, 10).map((log, idx) => (
                        <li key={`${log.incidentId}-${idx}`}>
                          <span className="mono">{new Date(log.createdAt).toLocaleString()}</span>
                          <br />
                          {log.action === "mitigate"
                            ? "Froze the treasury"
                            : log.action === "ignore"
                              ? "Dismissed alert"
                              : log.action === "acknowledge"
                                ? "Saw alert"
                                : log.action}{" "}
                          · {log.actor.startsWith("0x") ? shortAddress(log.actor) : "operator"}
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
                    <IconAutomation size={18} /> Playbooks
                  </h3>
                  <p className="muted">
                    Clear responses for each risk level. The helper only suggests — freezing the treasury still needs
                    your click in Alerts.
                  </p>
                  <div className="evidence-grid" style={{ marginTop: "1rem" }}>
                    <article>
                      <h4>Low</h4>
                      <p>Allow and keep watching</p>
                    </article>
                    <article>
                      <h4>Medium</h4>
                      <p>Ask a second signer</p>
                    </article>
                    <article>
                      <h4>High</h4>
                      <p>Hold for a manager review</p>
                    </article>
                    <article>
                      <h4>Critical</h4>
                      <p>Lock the treasury (human click)</p>
                    </article>
                  </div>
                </section>
                <section className="surface">
                  <h3>What the helper can do</h3>
                  {agentEval ? (
                    <p className="muted" style={{ marginBottom: "0.65rem" }}>
                      {agentEval.passed}/{agentEval.total} fixed policy cases match spec (
                      {((agentEval.conformanceRate ?? 0) * 100).toFixed(0)}%). Regression fixtures only — not
                      model validation.
                    </p>
                  ) : (
                    <p className="muted" style={{ marginBottom: "0.65rem" }}>
                      Responses follow fixed rules operators can audit.
                    </p>
                  )}
                  <ul className="clean">
                    <li>Suggest the next response from the risk score</li>
                    <li>Open an alert when a spend is blocked</li>
                    <li>Never move treasury funds</li>
                    <li>Never change the trusted payout list</li>
                    <li>Never lock the treasury without your click</li>
                  </ul>
                </section>
                <section className="surface">
                  <h3>Hard limits</h3>
                  <ul className="clean">
                    <li>Cannot move treasury funds</li>
                    <li>Cannot change the trusted payout list</li>
                    <li>Cannot grant admin access</li>
                    <li>Lock only after Lock the treasury is clicked</li>
                  </ul>
                </section>
              </div>
            )}

            {tab === "security" && (
              <div className="grid">
                <section className="surface span-2">
                  <h3>What is live, and what the proof covers</h3>
                  <p className="muted section-lead">
                    Arbitrum Sepolia and Robinhood Chain Testnet run the earlier native-lane deployment. Those addresses
                    are real and source-verified, but they predate the token lane and the policy attestation, so do not
                    read them as proof of the code you are looking at. Everything below is generated from the current
                    source by <code>npm run evidence -w packages/contracts</code> — run it and compare. Addresses and
                    explorer links: <code>docs/live-deployment.md</code>.
                  </p>
                  <p className="muted section-lead">
                    That first sentence is not taken on trust either. <code>npm run check:deployed</code> reads the
                    bytecode at every recorded address over each network&apos;s public RPC and compares the Solidity
                    metadata fingerprint with this build. Its output is the next section.
                  </p>
                </section>
                <section className="surface span-2">
                  <h3>
                    <IconSecurity size={18} /> Deployed bytecode vs this build · checked, not asserted
                  </h3>
                  <p className="muted section-lead">
                    {driftReport.summary.checked} contract{driftReport.summary.checked === 1 ? "" : "s"} read from
                    chain: {driftReport.summary.drifted} drifted, {driftReport.summary.matched} matched
                    {driftReport.summary.unreachable > 0
                      ? `, ${driftReport.summary.unreachable} unreachable`
                      : ""}
                    . A drifted contract is one whose deployed source is not the source you are reading now — the honest
                    status of both networks until the redeploy. {driftReport.note} Generated {DRIFT_GENERATED_AT} by{" "}
                    <code>npm run check:deployed</code>, which fails when a network&apos;s declared status and the chain
                    disagree.
                  </p>
                  {driftReport.networks.map((network) => (
                    <div key={network.name}>
                      <p className="muted section-lead">
                        <strong>{network.label}</strong> · chain {network.chainId} · declared {" "}
                        <code>{network.declared}</code>
                        {network.declared === "superseded"
                          ? " — expected to differ from this source, and it does"
                          : " — expected to match this source"}
                      </p>
                      <ul className="clean">
                        {network.contracts.map((c) => (
                          <li key={`${network.name}-${c.contract}`}>
                            <strong>
                              {c.verdict === "match"
                                ? "Matches"
                                : c.verdict === "drift"
                                  ? "Drifted"
                                  : c.verdict === "absent"
                                    ? "No code"
                                    : "Not read"}
                            </strong>
                            {" — "}
                            <a href={c.url} target="_blank" rel="noreferrer noopener">
                              {c.contract}
                            </a>
                            {c.onchainBytes !== null && c.localBytes !== null ? (
                              <span className="muted">
                                {" "}
                                · {c.onchainBytes.toLocaleString()} bytes on-chain vs {c.localBytes.toLocaleString()} in
                                this repo
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </section>
                <section className="surface span-2">
                  <h3>
                    <IconSecurity size={18} /> Contract quality · reproduced from source
                  </h3>
                  <p className="muted section-lead">
                    Not a claim — the artifact. {guardProof.summary.passed}/{guardProof.summary.total} cases behaved as
                    specified against a real Gnosis Safe v{PROOF_SAFE_VERSION}, with the guard installed the only way
                    Safe permits (an owner-approved call the Safe makes to itself). Generated {PROOF_GENERATED_AT} by{" "}
                    <code>npm run evidence -w packages/contracts</code>, which exits non-zero if any row drifts.
                  </p>
                  <div className="asset-grid">
                    <article className="asset-card">
                      <strong>Deny by default</strong>
                      <span>Limits</span>
                      <p>
                        An unconfigured wallet or Safe cannot spend at all. Zero means blocked; uncapped spending must be
                        granted explicitly.
                      </p>
                    </article>
                    <article className="asset-card">
                      <strong>Token lane</strong>
                      <span>USDG-ready</span>
                      <p>
                        Register an ERC-20, allowlist its counterparties, cap it per wallet per day in the token&apos;s
                        own base units — 6 decimals, not wei.
                      </p>
                    </article>
                    <article className="asset-card">
                      <strong>Approval guard</strong>
                      <span>Calldata-aware</span>
                      <p>An unlimited approval is refused, and an unrecognised call on a registered token is rejected.</p>
                    </article>
                    <article className="asset-card">
                      <strong>Policy attestation</strong>
                      <span>Versioned</span>
                      <p>Every decision is stamped with the policy version and digest that judged it.</p>
                    </article>
                    <article className="asset-card">
                      <strong>Access control</strong>
                      <span>RBAC</span>
                      <p>Policy roles control who can set limits, allowlist counterparties and freeze.</p>
                    </article>
                    <article className="asset-card">
                      <strong>Safe path</strong>
                      <span>Multisig guard</span>
                      <p>Installed inside a real Safe&apos;s execTransaction, so a blocked spend never executes.</p>
                    </article>
                  </div>
                </section>
                <section className="surface span-2">
                  <h3>Guard proof · every case, with its revert reason</h3>
                  <p className="muted section-lead">
                    Row 1 is the same payment as row 2, executed <em>before</em> the guard was installed — and it
                    settles. A screenshot of a blocked transaction proves nothing on its own; the before/after pair is
                    what shows the guard is the thing making the difference.
                  </p>
                  <ul className="clean">
                    {guardProof.cases.map((item) => (
                      <li key={item.id}>
                        <strong>{item.outcome === "blocked" ? "Refused" : "Settled"}</strong>{" — "}
                        {item.description}{" "}
                        {item.reason !== "—" ? (
                          <span className="muted">
                            · <code>{item.reason}</code>
                          </span>
                        ) : null}
                        {item.pass ? null : <strong> · NOT AS SPECIFIED</strong>}
                      </li>
                    ))}
                  </ul>
                </section>
                <section className="surface span-2">
                  <h3>Policy attestation · replayable from logs</h3>
                  <p className="muted section-lead">
                    Policy is versioned and hash-chained. Each amendment emits its parameters and folds into a running
                    digest, so the history can be recomputed from logs alone — no trust in the contract&apos;s storage —
                    and editing an early amendment changes every later digest.
                  </p>
                  <ul className="clean">
                    <li>
                      {guardProof.policyAttestation.amendmentsReplayed} policy amendments replayed from logs:{" "}
                      {guardProof.policyAttestation.replayFailures.length === 0 ? (
                        <>every digest recomputed and matched</>
                      ) : (
                        <strong>{guardProof.policyAttestation.replayFailures.length} digest mismatch</strong>
                      )}
                    </li>
                    <li>
                      {guardProof.policyAttestation.decisionsChecked -
                        guardProof.policyAttestation.decisionsWithUnknownPolicy}
                      /{guardProof.policyAttestation.decisionsChecked} allowed decisions stamped with a policy version
                      that exists in the amendment log
                    </li>
                    <li>
                      {guardProof.policyAttestation.distinctPolicyVersionsInDecisions} distinct policy versions across
                      those decisions — the stamp tracks amendments rather than reporting a constant
                    </li>
                    <li>
                      Head policy version {guardProof.policyAttestation.headVersion} · digest{" "}
                      <code>{shortDigest(guardProof.policyAttestation.headDigest)}</code>
                    </li>
                    <li className="muted">
                      Blocked decisions revert, so they leave no logs of their own; they are attributed to the policy
                      version in force at their block. The inline stamp is what makes an executed transfer reconcilable
                      afterwards.
                    </li>
                  </ul>
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
                          Enrolled treasury Safe
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
                          Enrolled treasury Safe
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
                    <li>Category: Arbitrum-native tooling · contract-enforced spend policy</li>
                  </ul>
                </section>
              </div>
            )}
          </div>
        </>
      )}

      <footer className="footer">
        <div>Arb Guardian — contract-enforced spend policy for delegated funds</div>
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
          {runtime === "api" ? " · Live" : null}
        </div>
      </footer>
      </div>
    </>
  );
}
