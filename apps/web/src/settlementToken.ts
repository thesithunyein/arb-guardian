/**
 * The settlement token, as read from the issuer's contract rather than as repeated.
 *
 * The submission copy quotes the token lane's caps in USDG, which makes every one of those numbers
 * a claim about somebody else's contract on a testnet — the kind of claim this repository refuses to
 * leave in prose. `npm run check:settlement` reads `symbol()`, `decimals()` and the code at the
 * declared address on each lane, compares them with `evidence/live-deployments.json`, and writes the
 * report bundled here. CI runs it, so the page goes red when the claim stops being true.
 *
 * `decimals` is the field that earns its place: a lane configured at the wrong scale misreads every
 * cap by a power of ten, and nothing about the policy source would look wrong.
 */
import raw from "../../../packages/contracts/evidence/settlement-token.json";

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

export const settlementGeneratedAt = settlementTokenReport.generatedAt
  .replace("T", " ")
  .replace(/\.\d+Z$/, " UTC");
