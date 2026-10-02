/**
 * The treasury policy, as a client.
 *
 * This is the single place that knows the shape of `PolicyManager` and `ExecutionGuard`:
 * their functions, their views, their custom errors and — the part that decides whether the
 * product is usable — what a limit value actually means.
 *
 * It exists because the same knowledge was previously written out three times: hand-rolled
 * ABI fragments in the web app, a second copy in the web API, and a third in the server
 * package. A contract that changes in one place and not the others is not a bug you notice;
 * it is a bug you ship. Everything product-facing now imports from here, and
 * `packages/contracts/test/PolicyClient.test.ts` drives this module against the real
 * contracts on a real chain, so "the client works" is a test rather than a belief.
 *
 * Deliberately free of any browser or Node API: the web app, the API and the test suite all
 * import the same file.
 */
import {
  Contract,
  ZeroHash,
  formatUnits,
  isAddress,
  keccak256,
  parseUnits,
  toUtf8Bytes,
  type ContractRunner
} from "ethers";

// --------------------------------------------------------------------------- constants

/** May change limits, allowlists and token registrations. */
export const POLICY_ADMIN_ROLE = keccak256(toUtf8Bytes("POLICY_ADMIN_ROLE"));
/** May pause the policy. OpenZeppelin's implicit admin role, also gates role grants. */
export const DEFAULT_ADMIN_ROLE = ZeroHash;

/**
 * "No cap" sentinel. Limits are deny-by-default: `0` means the wallet may not move the
 * asset at all, so uncapped spending has to be asked for explicitly rather than falling out
 * of an unset value. Mirrors `PolicyManager.UNLIMITED_LIMIT`.
 */
export const UNLIMITED_LIMIT = (1n << 256n) - 1n;

// ------------------------------------------------------------------------------- abi

const POLICY_VIEWS = [
  "function allowlistedCounterparty(address) view returns (bool)",
  "function walletDailyLimitWei(address) view returns (uint256)",
  "function tokenRegistered(address) view returns (bool)",
  "function tokenCounterpartyAllowed(address token, address counterparty) view returns (bool)",
  "function tokenDailyLimit(address token, address wallet) view returns (uint256)",
  "function isRegisteredToken(address) view returns (bool)",
  "function policyVersion() view returns (uint256)",
  "function policyDigest() view returns (bytes32)",
  "function policySnapshot() view returns (uint256 version, bytes32 digest)",
  "function paused() view returns (bool)",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function UNLIMITED_LIMIT() view returns (uint256)"
] as const;

const POLICY_WRITES = [
  "function pause()",
  "function unpause()",
  "function setCounterparty(address counterparty, bool allowed)",
  "function setWalletDailyLimit(address wallet, uint256 limitWei)",
  "function setTokenRegistered(address token, bool registered)",
  "function setTokenCounterparty(address token, address counterparty, bool allowed)",
  "function setTokenDailyLimit(address token, address wallet, uint256 limit)"
] as const;

const POLICY_EVENTS = [
  "event PolicyAmended(uint256 indexed version, bytes32 indexed digest, bytes32 indexed kind, bytes params, address actor)",
  "event CounterpartyAllowlistUpdated(address indexed counterparty, bool allowed, address indexed actor)",
  "event WalletDailyLimitUpdated(address indexed wallet, uint256 limitWei, address indexed actor)",
  "event TokenRegistrationUpdated(address indexed token, bool registered, address indexed actor)",
  "event TokenCounterpartyUpdated(address indexed token, address indexed counterparty, bool allowed, address indexed actor)",
  "event TokenDailyLimitUpdated(address indexed token, address indexed wallet, uint256 limit, address indexed actor)"
] as const;

/**
 * Declaring the custom errors is what lets ethers turn an opaque revert into a reason the
 * UI can show a person. OpenZeppelin's two errors are included because a wallet that simply
 * lacks the role reverts with `AccessControlUnauthorizedAccount`, and "you do not have
 * permission" is the single most likely thing a new operator will hit.
 */
const POLICY_ERRORS = [
  "error ZeroAddressNotAllowed()",
  "error AccessControlUnauthorizedAccount(address account, bytes32 neededRole)",
  "error AccessControlBadConfirmation()",
  "error EnforcedPause()",
  "error ExpectedPause()"
] as const;

export const POLICY_MANAGER_ABI = [
  ...POLICY_VIEWS,
  ...POLICY_WRITES,
  ...POLICY_EVENTS,
  ...POLICY_ERRORS
] as const;

export const EXECUTION_GUARD_ABI = [
  "function walletSpentTodayWei(address) view returns (uint256)",
  "function walletTokenSpentToday(address token, address wallet) view returns (uint256)",
  // The operator-facing dry run: decides and records without moving funds.
  "function validateAndRecord(address wallet, address destination, uint256 amountWei, bytes4 methodSelector) returns (bool allowed, string reason)",
  "event TransactionValidated(address indexed wallet, address indexed destination, uint256 amountWei, bytes4 methodSelector, bool blocked, string reason, address indexed actor, uint256 policyVersion, bytes32 policyDigest)",
  "error PolicyManagerPaused()",
  "error ZeroAddressNotAllowed()",
  "error CounterpartyNotAllowlisted(address destination)",
  "error DailyLimitExceeded(address wallet, uint256 attemptedAmount, uint256 limit)",
  "error DailyLimitNotConfigured(address wallet)",
  "error TokenNotRegistered(address token)",
  "error TokenCounterpartyNotAllowlisted(address token, address counterparty)",
  "error TokenDailyLimitNotConfigured(address token, address wallet)",
  "error TokenDailyLimitExceeded(address token, address wallet, uint256 attemptedAmount, uint256 limit)",
  "error ApprovalNotAllowed(address token, address spender, uint256 amount)",
  "error TransferFromSourceNotSafe(address token, address source, address safe)",
  "error UnsupportedTokenCall(address token, bytes4 selector)",
  "error DelegateCallNotAllowed()",
  "error InvalidAmount()"
] as const;

export function policyManager(address: string, runner: ContractRunner) {
  return new Contract(address, POLICY_MANAGER_ABI, runner);
}

export function executionGuard(address: string, runner: ContractRunner) {
  return new Contract(address, EXECUTION_GUARD_ABI, runner);
}

// -------------------------------------------------------------------------- limit math

export type LimitKind = "blocked" | "unbounded" | "capped";

/**
 * The three states a limit can be in, in the order that matters to an operator. "Blocked" is
 * not a missing configuration to be filled in later; on a deny-by-default contract it is the
 * safe default, and the UI has to say so rather than showing a `0`.
 */
export function classifyLimit(limit: bigint): LimitKind {
  if (limit === 0n) return "blocked";
  if (limit === UNLIMITED_LIMIT) return "unbounded";
  return "capped";
}

export type LimitDescription = {
  kind: LimitKind;
  /** Short label for a table or badge. */
  label: string;
  /** Full sentence for a detail view. */
  sentence: string;
  /** Whether this state should be surfaced as a warning. */
  risk: "none" | "attention";
};

export function describeLimit(limit: bigint, symbol: string, decimals = 18): LimitDescription {
  switch (classifyLimit(limit)) {
    case "blocked":
      return {
        kind: "blocked",
        label: "Blocked",
        sentence: `No ${symbol} can move. A limit of zero blocks spending rather than uncapping it.`,
        risk: "none"
      };
    case "unbounded":
      return {
        kind: "unbounded",
        label: "No cap",
        sentence: `Uncapped ${symbol}. This was granted explicitly and is not the result of an unset value.`,
        risk: "attention"
      };
    default:
      return {
        kind: "capped",
        label: `${trimNumber(formatUnits(limit, decimals))} ${symbol} / day`,
        sentence: `${trimNumber(formatUnits(limit, decimals))} ${symbol} per day.`,
        risk: "none"
      };
  }
}

/** `formatUnits` leaves trailing zeros that make a limit look more precise than it is. */
export function trimNumber(value: string): string {
  if (!value.includes(".")) return value;
  return value.replace(/\.?0+$/, "");
}

export type ParsedLimit = { ok: true; value: bigint } | { ok: false; error: string };

/**
 * Parse what a human types into base units. Accepts "0", "5", "5.5", and the words that mean
 * "no cap", because an operator thinking "unlimited" should not have to find the sentinel.
 */
export function parseLimitInput(input: string, decimals = 18): ParsedLimit {
  const raw = (input ?? "").trim().toLowerCase();
  if (!raw) return { ok: false, error: "Enter an amount, 0, or the word unlimited." };
  if (raw === "unlimited" || raw === "no cap" || raw === "max" || raw === "∞") {
    return { ok: true, value: UNLIMITED_LIMIT };
  }
  if (raw.startsWith("-")) return { ok: false, error: "A limit cannot be negative." };
  if (!/^\d*\.?\d*$/.test(raw) || raw === "." || raw === "") {
    return { ok: false, error: "Numbers only — for example 5 or 5.5." };
  }
  // Checked here rather than relying on parseUnits to throw, so the message can name the rule.
  const fraction = raw.includes(".") ? raw.split(".")[1] : "";
  if (fraction.length > decimals) {
    return { ok: false, error: `This asset has ${decimals} decimal places.` };
  }
  try {
    const value = parseUnits(raw, decimals);
    if (value > UNLIMITED_LIMIT) return { ok: false, error: "That is larger than any limit can be." };
    return { ok: true, value };
  } catch {
    return { ok: false, error: "That amount cannot be represented on chain." };
  }
}

/** Base units to base units, for tokens whose decimals differ from the native asset. */
export function parseBaseUnits(input: string, decimals: number): ParsedLimit {
  return parseLimitInput(input, decimals);
}

// ----------------------------------------------------------------------------- refusals

export type PolicyRefusal = {
  /** Revert name, or a transport-level code when the chain never saw the call. */
  name: string;
  /** Arguments the contract reverted with, stringified. */
  args: string[];
  /** What this means for the person who pressed the button, and what to do next. */
  operatorMessage: string;
  /** True when the wallet, not the policy, is the problem. */
  permission: boolean;
};

const REFUSALS: Record<string, string> = {
  AccessControlUnauthorizedAccount:
    "This wallet does not hold the role needed for that change on this treasury. A policy admin has to grant it — the role is named in the revert.",
  ZeroAddressNotAllowed: "That address is the zero address, which the contract refuses.",
  EnforcedPause: "The policy is paused. Pause blocks every change, including unpausing from here — a policy admin has to unpause it.",
  ExpectedPause: "The policy is not paused, so there is nothing to unpause.",
  CounterpartyNotAllowlisted:
    "The guard refused: that destination is not on the treasury allowlist.",
  DailyLimitExceeded: "The guard refused: the spend would take the wallet past its daily cap.",
  DailyLimitNotConfigured:
    "The guard refused: no daily limit is configured for this wallet, so on a deny-by-default contract it may not spend.",
  TokenNotRegistered: "The guard refused: that token is not registered for enforcement.",
  TokenCounterpartyNotAllowlisted:
    "The guard refused: that destination is not allowlisted for that token.",
  TokenDailyLimitNotConfigured:
    "The guard refused: no daily cap is configured for that wallet in that token.",
  TokenDailyLimitExceeded:
    "The guard refused: the transfer would take the wallet past its token cap.",
  ApprovalNotAllowed:
    "The guard refused: any standing token approval can be exercised outside the daily-cap path. Submit a bounded transfer instead.",
  TransferFromSourceNotSafe:
    "The guard refused: transferFrom must move tokens owned by the guarded Safe, not draw from another account's allowance.",
  UnsupportedTokenCall:
    "The guard refused: that call on a registered token is not one it can enforce.",
  DelegateCallNotAllowed: "The guard refused: a guard must never permit delegatecall.",
  InvalidAmount: "The contract refused a zero or otherwise invalid amount.",
  ACTION_REJECTED: "The transaction was declined in the wallet.",
  INSUFFICIENT_FUNDS: "This wallet cannot pay the gas for changed policy.",
  CALL_EXCEPTION: "The call reverted. The reason was not one this client recognises."
};

export function decodePolicyError(error: unknown): PolicyRefusal {
  const err = error as {
    revert?: { name?: string; args?: unknown[] };
    code?: string;
    shortMessage?: string;
    reason?: string;
  };

  const name = err?.revert?.name ?? err?.code ?? err?.reason ?? "UnknownError";
  const args = err?.revert?.args ? Array.from(err.revert.args).map((a) => String(a)) : [];
  const operatorMessage =
    REFUSALS[name] ??
    err?.shortMessage ??
    (error instanceof Error ? error.message : "The transaction failed without a readable reason.");
  const permission = name === "AccessControlUnauthorizedAccount";

  return { name, args, operatorMessage, permission };
}

// -------------------------------------------------------------------------- role gating

export type PolicyRoles = {
  address: string;
  policyAdmin: boolean;
  defaultAdmin: boolean;
};

export type PolicyAction =
  | "setWalletDailyLimit"
  | "setCounterparty"
  | "setTokenRegistered"
  | "setTokenCounterparty"
  | "setTokenDailyLimit"
  | "pause"
  | "unpause";

const ROLE_FOR_ACTION: Record<PolicyAction, "policyAdmin" | "defaultAdmin"> = {
  setWalletDailyLimit: "policyAdmin",
  setCounterparty: "policyAdmin",
  setTokenRegistered: "policyAdmin",
  setTokenCounterparty: "policyAdmin",
  setTokenDailyLimit: "policyAdmin",
  pause: "defaultAdmin",
  unpause: "defaultAdmin"
};

export function roleForAction(action: PolicyAction): "policyAdmin" | "defaultAdmin" {
  return ROLE_FOR_ACTION[action];
}

/**
 * Whether this address may perform the action, before the wallet is asked to sign anything.
 * Sending a transaction that reverts on the role check costs the user gas to learn something
 * the product could have told them for free.
 */
export function canPerform(roles: PolicyRoles, action: PolicyAction): boolean {
  return ROLE_FOR_ACTION[action] === "policyAdmin" ? roles.policyAdmin : roles.defaultAdmin;
}

export function explainMissingRole(action: PolicyAction, contract: string): string {
  const role = ROLE_FOR_ACTION[action];
  const name = role === "policyAdmin" ? "POLICY_ADMIN_ROLE" : "DEFAULT_ADMIN_ROLE";
  return `Changing this needs ${name} on ${contract}. Connect the wallet that administers this treasury, or ask it to grant the role.`;
}

// ------------------------------------------------------------------------------ reads

export type PolicyHead = {
  version: bigint;
  digest: string;
  paused: boolean;
};

export async function readPolicyHead(policy: Contract): Promise<PolicyHead> {
  const [snapshot, paused] = await Promise.all([policy.policySnapshot(), policy.paused()]);
  return {
    version: BigInt(snapshot[0]),
    digest: String(snapshot[1]),
    paused: Boolean(paused)
  };
}

export type PolicyAttestation = {
  /** Whether this deployment implements the versioned policy attestation at all. */
  supported: boolean;
  head: PolicyHead | null;
  /** Present when `supported` is false: why the client could not read a policy head. */
  reason?: string;
};

/**
 * Probe for the attestation rather than assuming it.
 *
 * A client that calls `policySnapshot()` unconditionally works against today's source and
 * blows up against any deployment built before the attestation existed — which is exactly
 * the deployment that is live while a redeploy is pending. Failing to detect it is a fact
 * about the deployment worth reporting in the UI, not an error worth crashing on.
 */
export async function detectPolicyAttestation(policy: Contract): Promise<PolicyAttestation> {
  try {
    const head = await readPolicyHead(policy);
    return { supported: true, head };
  } catch (error) {
    return {
      supported: false,
      head: null,
      reason: decodePolicyError(error).operatorMessage
    };
  }
}

export type WalletPolicy = {
  wallet: string;
  dailyLimitWei: bigint;
  spentTodayWei: bigint;
  remainingWei: bigint;
  limit: LimitDescription;
};

export async function readWalletPolicy(
  policy: Contract,
  guard: Contract,
  wallet: string
): Promise<WalletPolicy> {
  const [dailyLimitWei, spentTodayWei] = await Promise.all([
    policy.walletDailyLimitWei(wallet),
    guard.walletSpentTodayWei(wallet)
  ]);
  const limit = BigInt(dailyLimitWei);
  const spent = BigInt(spentTodayWei);
  return {
    wallet,
    dailyLimitWei: limit,
    spentTodayWei: spent,
    // Uncapped has nothing to subtract from; blocked has nothing left to spend.
    remainingWei: limit === UNLIMITED_LIMIT ? UNLIMITED_LIMIT : limit > spent ? limit - spent : 0n,
    limit: describeLimit(limit, "ETH")
  };
}

export async function readPolicyRoles(policy: Contract, address: string): Promise<PolicyRoles> {
  const [policyAdmin, defaultAdmin] = await Promise.all([
    policy.hasRole(POLICY_ADMIN_ROLE, address),
    policy.hasRole(DEFAULT_ADMIN_ROLE, address)
  ]);
  return {
    address,
    policyAdmin: Boolean(policyAdmin),
    defaultAdmin: Boolean(defaultAdmin)
  };
}

export type TokenPolicy = {
  token: string;
  wallet: string;
  /** Whether the guard enforces this token at all. */
  registered: boolean;
  /** Whether `counterparty` may receive this token from `wallet`. */
  counterpartyAllowed: boolean;
  dailyLimit: bigint;
  spentToday: bigint;
  limit: LimitDescription;
};

/**
 * Token policy needs both contracts: `PolicyManager` holds the rules, `ExecutionGuard` holds
 * how much of the day's budget is already gone. Reading limits without spend tells an operator
 * they have room they do not have.
 */
export async function readTokenPolicy(
  policy: Contract,
  guard: Contract,
  token: string,
  wallet: string,
  counterparty: string,
  symbol = "TOKEN",
  decimals = 18
): Promise<TokenPolicy> {
  const [registered, counterpartyAllowed, dailyLimit, spentToday] = await Promise.all([
    policy.isRegisteredToken(token),
    policy.tokenCounterpartyAllowed(token, counterparty),
    policy.tokenDailyLimit(token, wallet),
    guard.walletTokenSpentToday(token, wallet)
  ]);
  const limit = BigInt(dailyLimit);
  return {
    token,
    wallet,
    registered: Boolean(registered),
    counterpartyAllowed: Boolean(counterpartyAllowed),
    dailyLimit: limit,
    spentToday: BigInt(spentToday),
    limit: describeLimit(limit, symbol, decimals)
  };
}

// ----------------------------------------------------------------------------- writes

export type PolicyChange = {
  /** What was asked for, in words, for the audit log. */
  action: PolicyAction;
  txHash: string;
  blockNumber: number;
  /** The policy head *after* the change landed, read back from the contract. */
  head: PolicyHead;
};

/**
 * Every write follows the same path: send, wait, then read the policy attestation back. The
 * read-back is the point — it proves the change moved the versioned policy rather than only
 * touching a mapping, and it gives the operator the digest to cite.
 */
async function submit(
  policy: Contract,
  action: PolicyAction,
  method: string,
  args: unknown[]
): Promise<PolicyChange> {
  const tx = await policy[method](...args);
  const receipt = await tx.wait();
  const head = await readPolicyHead(policy);
  return {
    action,
    txHash: receipt?.hash ?? tx.hash,
    blockNumber: Number(receipt?.blockNumber ?? 0),
    head
  };
}

export function setWalletDailyLimit(
  policy: Contract,
  wallet: string,
  limitWei: bigint
): Promise<PolicyChange> {
  return submit(policy, "setWalletDailyLimit", "setWalletDailyLimit", [wallet, limitWei]);
}

export function setCounterparty(
  policy: Contract,
  counterparty: string,
  allowed: boolean
): Promise<PolicyChange> {
  return submit(policy, "setCounterparty", "setCounterparty", [counterparty, allowed]);
}

export function setTokenRegistered(
  policy: Contract,
  token: string,
  registered: boolean
): Promise<PolicyChange> {
  return submit(policy, "setTokenRegistered", "setTokenRegistered", [token, registered]);
}

export function setTokenCounterparty(
  policy: Contract,
  token: string,
  counterparty: string,
  allowed: boolean
): Promise<PolicyChange> {
  return submit(policy, "setTokenCounterparty", "setTokenCounterparty", [
    token,
    counterparty,
    allowed
  ]);
}

export function setTokenDailyLimit(
  policy: Contract,
  token: string,
  wallet: string,
  limit: bigint
): Promise<PolicyChange> {
  return submit(policy, "setTokenDailyLimit", "setTokenDailyLimit", [token, wallet, limit]);
}

export function setPolicyPaused(policy: Contract, paused: boolean): Promise<PolicyChange> {
  return submit(policy, paused ? "pause" : "unpause", paused ? "pause" : "unpause", []);
}

export function isValidAddress(value: string): boolean {
  return isAddress(value);
}
