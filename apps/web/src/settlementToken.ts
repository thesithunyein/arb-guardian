/**
 * The settlement token, as read from the issuer's contract rather than as repeated.
 *
 * The docs quote the token lane's caps in USDG, which makes every one of those numbers
 * a claim about somebody else's contract on a testnet — the kind of claim this repository refuses to
 * leave in prose. `npm run check:settlement` reads `symbol()`, `decimals()` and the code at the
 * declared address on each lane, compares them with `evidence/live-deployments.json`, and writes the
 * report bundled here. CI runs it, so the page goes red when the claim stops being true.
 *
 * `decimals` is the field that earns its place: a lane configured at the wrong scale misreads every
 * cap by a power of ten, and nothing about the policy source would look wrong.
 */
import raw from "../../../packages/contracts/evidence/settlement-token.json";

export type TokenLaneRead = {
  policyManager: string;
  token: string;
  treasury: string;
  recipient: string;
  registered: boolean | null;
  dailyLimitUnits: string | null;
  recipientAllowlisted: boolean | null;
  recipientAllowlistedToken: boolean | null;
  recipientAllowlistedNative: boolean | null;
  nativeWalletDailyLimitWei: string | null;
  paused: boolean | null;
};

export type SettlementTokenRead = {
  network: string;
  label: string;
  chainId: number;
  explorer: string;
  address: string;
  declaredSymbol: string | null;
  declaredDecimals: number | null;
  hasCode?: boolean;
  name?: string;
  symbol?: string;
  decimals?: number;
  supplyReadable?: boolean;
  /** Read from that lane's PolicyManager: registered, capped, allowlisted, unpaused. */
  lane?: TokenLaneRead | null;
  problems: string[];
  readFailed?: string;
};

export type SettlementTokenReport = {
  kind: string;
  generatedAt: string;
  networks: SettlementTokenRead[];
};

export const settlementTokenReport = raw as unknown as SettlementTokenReport;

/** A token claim holds only when every lane that declares one agreed with its contract. */
export const settlementTokenVerified = settlementTokenReport.networks.every(
  (network) => network.problems.length === 0
);

export function settlementTokenFor(chainId: number): SettlementTokenRead | null {
  return settlementTokenReport.networks.find((network) => network.chainId === chainId) ?? null;
}

/**
 * A lane counts as configured only when the chain says all of it: registered, capped above zero,
 * recipient allowlisted on the token lane, and not paused. Anything less is a partially wired lane,
 * and saying "configured" about it would be the same overstatement in the other direction.
 */
export function laneConfigured(lane: TokenLaneRead | null | undefined): boolean {
  if (!lane) return false;
  return (
    lane.registered === true &&
    lane.dailyLimitUnits !== null &&
    BigInt(lane.dailyLimitUnits) > 0n &&
    lane.recipientAllowlistedToken === true &&
    lane.paused === false
  );
}

/** Base units to whole tokens, for a reader who does not want to divide by a million in their head. */
export function laneCapUnits(lane: TokenLaneRead | null | undefined, decimals: number | null | undefined): string {
  if (!lane?.dailyLimitUnits || decimals === null || decimals === undefined) return "not set";
  const units = BigInt(lane.dailyLimitUnits);
  const scale = 10n ** BigInt(decimals);
  const whole = units / scale;
  const fraction = units % scale;
  if (fraction === 0n) return whole.toLocaleString();
  return `${whole.toLocaleString()}.${fraction.toString().padStart(decimals, "0").replace(/0+$/, "")}`;
}

export const settlementGeneratedAt = settlementTokenReport.generatedAt
  .replace("T", " ")
  .replace(/\.\d+Z$/, " UTC");
