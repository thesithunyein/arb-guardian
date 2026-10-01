/**
 * The site states that the live addresses run an earlier build. That statement used to be
 * prose, which is exactly the kind of claim a reader has no way to check.
 *
 * It is now generated: `npm run check:deployed` reads the bytecode at every address in
 * `packages/contracts/evidence/live-deployments.json` over each network's public RPC,
 * compares the Solidity metadata fingerprint and runtime size against this repository's
 * build, and writes `evidence/deployed-drift.json`. Each network declares whether it is
 * supposed to match this source; the script fails when the declaration and the chain
 * disagree.
 *
 * Bundling the committed report is the same trade as the guard proof: it is a recording,
 * but a reproducible one, and it goes red in CI when it stops being true.
 */
import raw from "../../../packages/contracts/evidence/deployed-drift.json";

export type DriftContract = {
  contract: string;
  address: string;
  url: string;
  onchainBytes: number | null;
  localBytes: number | null;
  onchainMetadata: string | null;
  localMetadata: string | null;
  solc: string | null;
  verdict: "match" | "drift" | "absent" | "unreachable" | "not-compared" | "unknown";
  claim: string;
  claimHeld: boolean | null;
  error?: string;
};

export type DriftNetwork = {
  name: string;
  label: string;
  chainId: number;
  explorer: string;
  declared: "current" | "superseded";
  reachable: boolean;
  contracts: DriftContract[];
};

export type DriftReport = {
  kind: string;
  generatedAt: string;
  method: string;
  note: string;
  compiled: boolean;
  networks: DriftNetwork[];
  summary: {
    networks: number;
    checked: number;
    matched: number;
    drifted: number;
    absent: number;
    unreachable: number;
    claimsHeld: number;
    claimsViolated: number;
  };
};

export const driftReport = raw as unknown as DriftReport;

/** Every contract of ours that the report managed to read from the chain. */
export const driftedContracts = driftReport.networks.flatMap((network) =>
  network.contracts.filter((c) => c.verdict === "drift" || c.verdict === "match")
);
