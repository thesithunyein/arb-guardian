/**
 * Source verification, as recorded by the verifier rather than as claimed here.
 *
 * The cheapest check on smart-contract quality is the explorer's source panel. Arbiscan wants
 * an API key, so the keyless path is Sourcify: it recompiles the compiler's own standard JSON input
 * and compares both the creation and runtime bytecode. `node scripts/verify-sourcify.mjs` submits the
 * six contracts, then reads each explorer's own API to record whether the panel a visitor would click
 * agrees. The report is committed and bundled here, so this page cannot claim a verification that the
 * verifier did not answer.
 *
 * The Arbiscan panel is deliberately absent: it needs `ARBISCAN_API_KEY`, and until that exists this
 * page says so rather than implying the panel is published.
 */
import raw from "../../../packages/contracts/evidence/sourcify.json";
import arbiscanRaw from "../../../packages/contracts/evidence/arbiscan.json";

export type VerifiedContract = {
  contract: string;
  address: string;
  creationTransactionHash: string | null;
  compiler: string | null;
  ok: boolean;
  match: string | null;
  creationMatch: string | null;
  runtimeMatch: string | null;
  verifiedAt: string | null;
  repository: string | null;
  explorerPanel: {
    explorer: string;
    verified: boolean;
    fullyVerified?: boolean;
    contractName?: string | null;
    error?: string;
  } | null;
  detail: string | null;
};

export type VerifiedLane = {
  lane: string;
  network: string;
  chainId: number;
  explorer: string | null;
  contracts: VerifiedContract[];
};

export type SourceVerificationReport = {
  checkedAt: string;
  verifier: string;
  summary: { verified: number; total: number; explorerPanels: number; lanes: number };
  lanes: VerifiedLane[];
};

export const sourceVerificationReport = raw as unknown as SourceVerificationReport;

export const sourceVerifiedAt = sourceVerificationReport.checkedAt
  .replace("T", " ")
  .replace(/\.\d+Z$/, " UTC");

/** Every contract is published only when the verifier matched all of them. */
export const sourceVerificationComplete =
  sourceVerificationReport.summary.verified === sourceVerificationReport.summary.total;

export const sourceExplorerPanels =
  sourceVerificationReport.summary.explorerPanels === sourceVerificationReport.summary.total;

/**
 * Arbiscan, which is the most commonly opened panel and the only one that needs an API key.
 *
 * The record is written by `npm run verify:arbiscan`, which submits the same standard JSON input,
 * waits for the queue, and reads the result back from Arbiscan rather than assuming it. When no key
 * is present the script records `pending_key` instead of staying silent, so this page can say what is
 * missing and what would finish it — and a key that goes missing cannot erase an earlier confirmed
 * publication.
 */
export type ArbiscanContract = {
  contract: string;
  address: string;
  explorer: string;
  published: boolean | null;
  publishedAt: string | null;
  status: string;
  guid: string | null;
  error: string | null;
};

export type ArbiscanReport = {
  checkedAt: string;
  network: string;
  chainId: number;
  explorer: string;
  method: string;
  blockedOn: string | null;
  summary: { published: number; total: number; pendingKey: number; unread: number };
  contracts: ArbiscanContract[];
};

export const arbiscanReport = arbiscanRaw as unknown as ArbiscanReport;

export const arbiscanPublishedAll =
  arbiscanReport.summary.published === arbiscanReport.summary.total;

export const arbiscanCheckedAt = arbiscanReport.checkedAt
  .replace("T", " ")
  .replace(/\.\d+Z$/, " UTC");
