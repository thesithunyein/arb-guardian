import { useEffect, useMemo, useState, type FormEvent, type ReactElement } from "react";
import { isAddress, parseEther } from "ethers";
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
  IconSun
} from "./icons";
import { guardProof, shortDigest } from "./guardProof";
import { driftReport } from "./deployedDrift";
import { assessIntent, predictGuardOutcome, recommendPlaybook, type RiskAssessment } from "./riskEngine";
import { useTheme } from "./useTheme";
import { connectWallet, shortAddress, signEnrollMessage } from "./wallet";

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

type TabId = "home" | "review" | "alerts" | "automation" | "security";
type SpendMethod = "transfer" | "approve";

/**
 * The spend an operator is asking about, before it goes out.
 *
 * This used to be three canned scenarios against `0x1111…` addresses, and the policy they were
 * judged against came from the constants sitting next to them rather than from the chain. That
 * let the "normal vendor payout" row be shown as allowed on a deployment where that wallet had
 * no limit and that payee was not allowlisted. The inputs are the operator's now, and the only
 * policy is the one read back from the contract.
 */
type SpendDraft = {
  wallet: string;
  destination: string;
  amountEth: string;
  method: SpendMethod;
};

/** The evidence pack writes an ISO timestamp; render it without the millisecond noise. */
const PROOF_GENERATED_AT = guardProof.generatedAt.replace("T", " ").replace(/\.\d+Z$/, " UTC");
const DRIFT_GENERATED_AT = driftReport.generatedAt.replace("T", " ").replace(/\.\d+Z$/, " UTC");
const PROOF_SAFE_VERSION = guardProof.safeVersion.split(" ")[0];

const PLAYBOOK_LABELS: Record<string, string> = {
  "freeze-wallet-and-revoke-approvals": "Freeze the treasury account",
  "hold-transaction-and-require-admin-review": "Hold for an admin review",
  "request-secondary-signer-confirmation": "Ask a second signer",
  "allow-with-monitoring": "Allow and keep watching"
};

function playbookLabel(id: string) {
  return PLAYBOOK_LABELS[id] ?? id.replace(/-/g, " ");
}

/**
 * The verdict, in the rule's own words. The old version named the scenario, so every block read as
 * "Block — unlimited approval" whether or not that was the rule that fired.
 */
function plainOutcome(assessment: RiskAssessment) {
  if (!assessment.blocked) return "Allow — within policy";
  const why = assessment.matches[0]?.reason ?? "outside policy";
  if (assessment.totalScore >= 80) return `Block — ${why}`;
  return `Hold — ${why}`;
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
  return shortAddress(addr);
}

/**
 * A stable id for a spend that has not happened yet. Checking the same spend twice must land on
 * the same incident, so this is computed from the spend rather than from the clock.
 */
function draftId(parts: string[]) {
  const input = parts.join("|");
  let hash = 0n;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31n + BigInt(input.charCodeAt(i))) % 2n ** 64n;
  }
  return hash.toString(16).padStart(16, "0");
}

export function App() {
  const { theme, toggleTheme } = useTheme();
  const [tab, setTab] = useState<TabId>("home");
  // Defaults to the live treasury Safe, which is the address that actually carries a policy on
  // chain. An operator can point it at anything.
  const [spend, setSpend] = useState<SpendDraft>(() => ({
    wallet: loadLocalEnroll()?.address ?? TREASURY_SAFE,
    destination: "",
    amountEth: "1",
    method: "transfer"
  }));
  const [assessment, setAssessment] = useState<RiskAssessment | null>(null);
  const [policyState, setPolicyState] = useState<OnchainPolicy | null>(null);
  /** Whether the policy on screen came back from the contract. Never inferred from a fallback. */
  const [policySource, setPolicySource] = useState<"unchecked" | "onchain" | "unavailable">("unchecked");
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
  const [entered, setEntered] = useState(false);
  const [treasuryName, setTreasuryName] = useState(() => loadTreasuryName());
  const [editingTreasury, setEditingTreasury] = useState(false);
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
      localStorage.setItem(TREASURY_STORAGE, treasuryName);
    } catch {
      // ignore
    }
  }, [treasuryName]);

  useEffect(() => {
    persistIncidents(incidents);
  }, [incidents]);

  function enterWorld() {
    setEntered(true);
    setTab("home");
    setAssessment(null);
    setWhyOpen(false);
  }

  function goCheck() {
    setEntered(true);
    setAssessment(null);
    setWhyOpen(false);
    setTab("review");
  }

  function goVault() {
    setTab("security");
  }

  function resetSession() {
    setAssessment(null);
    setIncidents([]);
    setAuditLog([]);
    setLastPlaybook(null);
    setKpi({ totalAssessments: 0, blockedCount: 0, blockedRate: 0, criticalIncidentCount: 0 });
    setPolicyPaused(null);
    try {
      sessionStorage.removeItem(INCIDENTS_STORAGE);
    } catch {
      // ignore
    }
    setTab("home");
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
    } catch (err) {
      setEnrollMsg(err instanceof Error ? err.message : "Could not connect wallet");
    } finally {
      setEnrollBusy(false);
    }
  }

  function disconnectWallet() {
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
      const res = await fetch(`${API_BASE}/treasuries`, {
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
      const res = await fetch(`${API_BASE}/treasuries`, {
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

  /**
   * The spend, parsed and checked. A block here is a form error, not a policy decision — the
   * policy decision needs a real address and a real amount to read the contract for.
   */
  const check = useMemo(() => {
    const wallet = spend.wallet.trim();
    const destination = spend.destination.trim();
    let amountWei = "0";
    let amountError: string | null = null;
    const amount = Number(spend.amountEth.trim());
    if (!spend.amountEth.trim()) {
      amountError = "Enter the amount this spend moves.";
    } else if (!Number.isFinite(amount) || amount <= 0) {
      amountError = "The amount has to be a positive number.";
    } else {
      try {
        amountWei = parseEther(spend.amountEth.trim()).toString();
      } catch {
        amountError = "The amount has more precision than ETH can carry.";
      }
    }
    const error =
      (isAddress(wallet) ? null : "Enter the address the money moves from — a treasury or operator key.") ??
      (isAddress(destination) ? null : "Enter the payee address.") ??
      amountError;
    return {
      wallet,
      destination,
      amountWei,
      method: spend.method,
      error,
      txHash: `0xdraft-${draftId([wallet.toLowerCase(), destination.toLowerCase(), amountWei, spend.method])}`
    };
  }, [spend]);

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
      return;
    }
    const item: IncidentItem = {
      id: `inc-${txHash}`,
      title: `Blocked · ${vendorName(check.destination)} · ${formatEth(check.amountWei)}`,
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
    fetch(`${API_BASE}/treasuries`)
      .then((r) => (r.ok ? r.json() : null))
      .then(async (data) => {
        if (!data) return;
        applyTreasuryStats(data as Partial<TreasuryStats> & { treasuries?: Array<{ ownerFull?: string; usageCount?: number }> });
        const list = (data as { treasuries?: Array<{ ownerFull?: string; usageCount?: number }> }).treasuries ?? [];
        if (local) {
          const mine = list.find((g) => g.ownerFull?.toLowerCase() === local.address.toLowerCase());
          if (mine) {
            if (typeof mine.usageCount === "number") setMyUsage(mine.usageCount);
          } else {
            // Re-publish signed enroll so roster survives serverless cold starts
            try {
              const res = await fetch(`${API_BASE}/treasuries`, {
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
    if (check.error) {
      setError(check.error);
      setTab("review");
      return;
    }

    setLoading(true);
    setError(null);
    setWhyOpen(false);
    setTab("review");
    try {
      if (runtime === "api" && API_BASE) {
        // No policy values are sent from here. The server reads the contract for these two
        // addresses, and where it cannot, its own defaults deny the spend rather than trust
        // anything the browser handed it.
        const res = await fetch(`${API_BASE}/risk/assess`, {
          method: "POST",
          headers: buildHeaders(true),
          body: JSON.stringify({
            txHash: check.txHash,
            wallet: check.wallet,
            destination: check.destination,
            method: check.method,
            amountWei: check.amountWei
          })
        });
        if (!res.ok) throw new Error(`Review failed (${res.status})`);
        const data = (await res.json()) as {
          assessment: RiskAssessment & { matches: RiskAssessment["matches"] };
          incident: null | { id: string; title: string; recommendedPlaybook: string };
          policyState?: OnchainPolicy & { source?: "onchain" | "request" };
        };
        const result: RiskAssessment = {
          totalScore: data.assessment.totalScore,
          blocked: data.assessment.blocked,
          matches: data.assessment.matches,
          recommendedPlaybook: data.incident?.recommendedPlaybook ?? recommendPlaybook(data.assessment.totalScore)
        };
        setAssessment(result);

        const readFromChain = data.policyState?.source === "onchain" ? data.policyState : null;
        setPolicyState(readFromChain);
        setPolicySource(readFromChain ? "onchain" : "unavailable");
        setGuardPrediction(
          readFromChain
            ? predictGuardOutcome({
                allowlisted: readFromChain.allowlisted,
                dailyLimitWei: readFromChain.dailyLimitWei,
                spentTodayWei: readFromChain.spentTodayWei,
                amountWei: check.amountWei,
                policyPaused: readFromChain.policyPaused
              })
            : null
        );

        if (result.blocked) {
          const incidentId = data.incident?.id ?? `inc-${check.txHash}`;
          setIncidents((prev) => [
            {
              id: incidentId,
              title:
                data.incident?.title ??
                `Blocked · ${vendorName(check.destination)} · ${formatEth(check.amountWei)}`,
              severity: result.totalScore >= 80 ? "critical" : "high",
              recommendedPlaybook: result.recommendedPlaybook,
              status: "open"
            },
            ...prev.filter((i) => i.id !== incidentId)
          ]);
        }
        void recordTreasuryUsage("review");
        return;
      }

      // No API in this build: read the contract directly and decide here.
      let onchain: OnchainPolicy | null = null;
      try {
        onchain = await readOnchainPolicy(check.wallet, check.destination);
      } catch {
        onchain = null;
      }

      if (!onchain) {
        // Reading the policy is the entire point of the check. If it did not come back, the honest
        // answer is no — and it is reported as a refusal, so it lands in the queue like any other.
        setPolicyState(null);
        setPolicySource("unavailable");
        setGuardPrediction(null);
        recordLocal(
          {
            totalScore: 100,
            blocked: true,
            matches: [
              {
                ruleId: "RULE_POLICY_UNREADABLE",
                reason: "The policy could not be read from the chain, so this spend cannot be approved",
                severity: "critical",
                scoreDelta: 100
              }
            ],
            recommendedPlaybook: "freeze-wallet-and-revoke-approvals"
          },
          check.txHash,
          check.wallet
        );
        void recordTreasuryUsage("review");
        return;
      }

      setPolicyState(onchain);
      setPolicySource("onchain");
      const policyInput = {
        allowlisted: onchain.allowlisted,
        dailyLimitWei: onchain.dailyLimitWei,
        spentTodayWei: onchain.spentTodayWei,
        amountWei: check.amountWei,
        method: check.method,
        policyPaused: onchain.policyPaused
      };
      const result = assessIntent(policyInput);
      setGuardPrediction(predictGuardOutcome(policyInput));
      recordLocal(result, check.txHash, check.wallet);
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
            className="icon-btn"
            onClick={() => {
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
            <button type="button" className="ghost" onClick={goCheck}>
              Check a spend
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
                          setTab("alerts");
                        }}
                      >
                        <IconAlerts size={16} />
                        {policyPaused ? "Manage lock" : "Open alerts"}
                      </button>
                    ) : (
                      <button type="button" className="primary" onClick={goCheck}>
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
                <form
                  className="surface review-main"
                  onSubmit={(e: FormEvent) => {
                    e.preventDefault();
                    void runAssessment();
                  }}
                >
                  <div className="review-head">
                    <div>
                      <div className="review-badges">
                        <span className="review-badge">
                          {policySource === "onchain"
                            ? "Read from the contract"
                            : policySource === "unavailable"
                              ? "Policy unreadable"
                              : "Not checked"}
                        </span>
                        {policySource === "onchain" && policyState ? (
                          policyState.allowlisted ? (
                            <span className="review-badge ok">Trusted payee</span>
                          ) : (
                            <span className="review-badge risk">Unknown payee</span>
                          )
                        ) : null}
                      </div>
                      <h3>Check a spend before it leaves</h3>
                      <p className="muted">
                        Give it the treasury and the payee, and it reads the policy contract for both. Nothing typed here
                        is taken on trust over the chain.
                      </p>
                    </div>
                  </div>

                  <label className="spend-field">
                    <span>From — treasury or operator address</span>
                    <input
                      className="treasury-input"
                      value={spend.wallet}
                      onChange={(e) => setSpend((s) => ({ ...s, wallet: e.target.value }))}
                      placeholder="0x…"
                      spellCheck={false}
                    />
                  </label>
                  <label className="spend-field">
                    <span>To — payee address</span>
                    <input
                      className="treasury-input"
                      value={spend.destination}
                      onChange={(e) => setSpend((s) => ({ ...s, destination: e.target.value }))}
                      placeholder="0x…"
                      spellCheck={false}
                    />
                  </label>
                  <div className="spend-form-row">
                    <label className="spend-field">
                      <span>Amount (ETH)</span>
                      <input
                        className="treasury-input"
                        value={spend.amountEth}
                        onChange={(e) => setSpend((s) => ({ ...s, amountEth: e.target.value }))}
                        inputMode="decimal"
                      />
                    </label>
                    <label className="spend-field">
                      <span>Type</span>
                      <select
                        className="treasury-input"
                        value={spend.method}
                        onChange={(e) => setSpend((s) => ({ ...s, method: e.target.value as SpendMethod }))}
                      >
                        <option value="transfer">Vendor payout</option>
                        <option value="approve">Permission to spend</option>
                      </select>
                    </label>
                  </div>
                  {check.error ? <p className="error">{check.error}</p> : null}

                  <dl className="meta review-meta">
                    <div>
                      <dt>From</dt>
                      <dd title={check.wallet}>{check.wallet ? vendorName(check.wallet) : "—"}</dd>
                    </div>
                    <div>
                      <dt>To</dt>
                      <dd title={check.destination}>{check.destination ? vendorName(check.destination) : "—"}</dd>
                    </div>
                    <div>
                      <dt>Amount</dt>
                      <dd>{formatEth(check.amountWei)}</dd>
                    </div>
                    <div>
                      <dt>Type</dt>
                      <dd>{methodLabel(check.method)}</dd>
                    </div>
                    <div>
                      <dt>Day limit</dt>
                      <dd title="Most this address can send today">
                        {policyState ? budgetDisplay(policyState, "0") : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt>Spent today</dt>
                      <dd title="Already sent from this address today">
                        {policyState ? spentDisplay(policyState, "0") : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt>Trusted payee</dt>
                      <dd>{policyState ? (policyState.allowlisted ? "Yes" : "No") : "—"}</dd>
                    </div>
                    <div>
                      <dt>Policy</dt>
                      <dd>
                        {!policyState ? "—" : policyState.policyPaused ? "Frozen" : "Active"}
                      </dd>
                    </div>
                  </dl>
                  <p className="muted review-budget-hint">
                    {policySource === "onchain"
                      ? "Those figures came back from the contract, for the two addresses above."
                      : policySource === "unavailable"
                        ? "The policy could not be read for those addresses, so this refuses rather than guesses."
                        : "Day limit = most this address can send today. Spent today = already used. Unknown payee = not on the trusted list."}
                  </p>

                  {!assessment ? (
                    <div className="review-connect-gate">
                      <button type="submit" className="primary full review-cta" disabled={loading || Boolean(check.error)}>
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
                          {plainOutcome(assessment)}
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
                              setAssessment(null);
                              setPolicySource("unchecked");
                            }}
                          >
                            Review another
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </form>
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
                      <button type="button" className="ghost" onClick={goCheck}>
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
