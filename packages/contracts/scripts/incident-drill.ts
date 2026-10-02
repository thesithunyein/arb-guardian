/**
 * Run the freeze drill against the live deployment and record what happened.
 *
 * The submission claims a control plane an operator can act on: a risky request is refused, an
 * incident appears, the freeze playbook pauses the policy onchain, and the lane resumes when the
 * operator clears it. Until this drill, every part of that claim was a screenshot away from
 * being unverifiable — the freeze path existed in the product but had never been exercised end
 * to end against the addresses the docs point at.
 *
 * The drill is deliberately built so the freeze proves itself:
 *
 *   1. a spend through the enrolled Safe would settle          (nothing is frozen yet)
 *   2. a risky request is assessed and refused, incident opens
 *   3. the operator mitigates, which pauses PolicyManager onchain
 *   4. the *same* spend is now refused by the guard            (SafeTreasuryGuard: PolicyManagerPaused)
 *   5. the operator unpauses, and the same spend settles again
 *
 * Step 4 is the point. Step 5 exists so a drill can never leave the live lane frozen: the
 * unfreeze runs from a `finally`, and if the API unpause fails it is retried directly onchain.
 *
 * Writes evidence/incident-drill.json, which the submission copy quotes.
 *
 *   npm run drill:incident -w packages/contracts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ethers, network } from "hardhat";

/**
 * Structural stand-ins for the transaction and receipt shapes.
 *
 * Importing the types from "ethers" does not work here: a bare `ethers` specifier in this
 * workspace resolves to a stray v5.4.0 copy, while `from "hardhat"` is the v6 build the scripts
 * actually run against. Describing only the fields this file reads keeps the drill on the same
 * ethers the rest of the scripts use.
 */
type AnyTx = { hash: string; wait: () => Promise<AnyReceipt> };
type AnyReceipt = { status?: number | null; gasUsed?: bigint | null };

const API = process.env.AG_API_URL ?? "https://arb-guardian.sithunyein.com";
const PAYROLL = "0x4444444444444444444444444444444444444444";
const UNLISTED = "0x5555555555555555555555555555555555555555";
/** The amount the enrollment already proved this Safe may spend. */
const DRILL_SPEND = ethers.parseEther("0.001");
const FORCED_GAS_LIMIT = 1_500_000n;

const SAFE_ABI = [
  "function nonce() view returns (uint256)",
  "function getThreshold() view returns (uint256)",
  "function approveHash(bytes32 hashToApprove)",
  "function getTransactionHash(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, uint256 _nonce) view returns (bytes32)",
  "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) returns (bool)"
];

type Deployment = {
  network: string;
  chainId: number;
  policyManager: { address: string };
  safeTreasuryGuard: { address: string };
  realSafe: { address: string };
};

/** Only the fields the drill reads; the API answers with more. */
type ApiBody = {
  assessment?: {
    totalScore?: number;
    blocked?: boolean;
    matches?: Array<{ ruleId: string }>;
    recommendedPlaybook?: string;
  };
  incident?: { id?: string; severity?: string };
  playbookExecution?: { playbook?: string; executed?: boolean; txHash?: string | null };
  txHash?: string;
};

const steps: Array<Record<string, unknown>> = [];
const startedAt = Date.now();
const stamp = () => new Date().toISOString();
const since = (from: number) => Date.now() - from;

async function post(path: string, body: unknown) {
  const response = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  let parsed: ApiBody | null = null;
  try {
    parsed = JSON.parse(text) as ApiBody;
  } catch {
    // reported raw below
  }
  return { status: response.status, body: parsed, text };
}

async function get(path: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${API}${path}`);
  const text = await response.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw: text, status: response.status };
  }
}

async function main() {
  const recordPath = resolve(__dirname, "..", "deployments", `${network.name}.json`);
  const record = JSON.parse(readFileSync(recordPath, "utf8")) as Deployment;
  if (network.name !== "arbitrumSepolia") {
    throw new Error(`This drill runs against the primary lane; got --network ${network.name}.`);
  }

  const signer = (await ethers.getSigners())[0];
  const policy = await ethers.getContractAt("PolicyManager", record.policyManager.address, signer);
  const safe = new ethers.Contract(record.realSafe.address, SAFE_ABI, signer);

  console.log(`\nArb Guardian freeze drill`);
  console.log(`  lane        ${record.network} (chain ${record.chainId})`);
  console.log(`  policy      ${record.policyManager.address}`);
  console.log(`  guard       ${record.safeTreasuryGuard.address}`);
  console.log(`  treasury    ${record.realSafe.address} (Safe)`);
  console.log(`  operator    ${signer.address}`);
  console.log(`  live API    ${API}`);

  const alreadyPaused: boolean = await policy.paused();
  if (alreadyPaused) {
    throw new Error("PolicyManager is already paused. Refusing to run a drill on a frozen lane.");
  }

  const before = await get("/api/kpi");
  console.log(`\n  starting state: paused=${alreadyPaused}, live incidents=${before.incidentCount ?? "?"}`);

  /**
   * Wait for a receipt without treating a revert as a crash.
   *
   * The frozen refusal is *supposed* to revert, and ethers throws on a status-0 receipt rather
   * than returning it — which is how the first drill run ended early at exactly the step it was
   * meant to prove. The receipt rides along on the error, so read it from there.
   */
  async function waitAllowingRevert(tx: AnyTx) {
    try {
      const receipt = await tx.wait();
      return { receipt, reverted: false };
    } catch (error) {
      const receipt = (error as { receipt?: AnyReceipt }).receipt;
      if (!receipt) throw error;
      return { receipt, reverted: receipt.status === 0 };
    }
  }

  /** Execute through the Safe, the only path Safe 1.4.1 permits a guard to see. */
  async function execSafeTx(to: string, value: bigint, opts?: { forceGas?: bigint }) {
    const nonce = await safe.nonce();
    const txHash: string = await safe.getTransactionHash(
      to,
      value,
      "0x",
      0,
      0n,
      0n,
      0n,
      ethers.ZeroAddress,
      ethers.ZeroAddress,
      nonce
    );
    await (await safe.approveHash(txHash)).wait();
    const signature = ethers.concat([
      ethers.zeroPadValue(signer.address, 32),
      ethers.ZeroHash,
      "0x01"
    ]);
    if (opts?.forceGas) {
      const request = await safe.execTransaction.populateTransaction(
        to,
        value,
        "0x",
        0,
        0n,
        0n,
        0n,
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        signature
      );
      return signer.sendTransaction({ ...request, gasLimit: opts.forceGas });
    }
    return safe.execTransaction(to, value, "0x", 0, 0n, 0n, 0n, ethers.ZeroAddress, ethers.ZeroAddress, signature);
  }

  let paused = false;

  try {
    // ---------------------------------------------------------------- 1. refused decision
    const drillTxHash = `0x${ethers.id(`arb-guardian-drill-${Date.now()}`).slice(2)}`;
    const submitted = Date.now();
    const assessment = await post("/api/risk/assess", {
      txHash: drillTxHash,
      wallet: record.realSafe.address,
      destination: UNLISTED,
      method: "approve",
      amountWei: DRILL_SPEND.toString(),
      allowlisted: false
    });
    const detectionMs = since(submitted);
    const decision = assessment.body?.assessment;
    const incident = assessment.body?.incident;

    if (!decision?.blocked || !incident?.id) {
      throw new Error(
        `The live API did not refuse the drill request (HTTP ${assessment.status}): ${assessment.text.slice(0, 300)}`
      );
    }
    console.log(
      `\n  refused: score ${decision.totalScore} · playbook ${decision.recommendedPlaybook} · detected in ${detectionMs}ms`
    );
    console.log(`  incident: ${incident.id} (${incident.severity})`);
    steps.push({
      step: "assessment",
      at: stamp(),
      request: {
        txHash: drillTxHash,
        wallet: record.realSafe.address,
        destination: UNLISTED,
        method: "approve",
        allowlisted: false
      },
      decision: {
        totalScore: decision.totalScore,
        blocked: decision.blocked,
        rules: (decision.matches ?? []).map((m: { ruleId: string }) => m.ruleId),
        recommendedPlaybook: decision.recommendedPlaybook
      },
      incidentId: incident.id,
      detectionMs
    });

    // ------------------------------------------------------------------- 2. operator freeze
    const mitigStarted = Date.now();
    const mitigated = await post(`/api/incidents/${encodeURIComponent(incident.id)}/action`, {
      action: "mitigate",
      actor: "incident-drill"
    });
    const freezeMs = since(mitigStarted);
    const freezeTx = mitigated.body?.playbookExecution?.txHash ?? null;
    console.log(
      `\n  freeze: playbook ${mitigated.body?.playbookExecution?.playbook} executed=${mitigated.body?.playbookExecution?.executed} in ${freezeMs}ms`
    );
    console.log(`  pause tx: ${freezeTx ?? mitigated.text.slice(0, 200)}`);

    const pausedAfterMitigate: boolean = await policy.paused();
    if (!pausedAfterMitigate) throw new Error("The mitigate playbook did not pause the policy onchain.");
    paused = true;
    steps.push({
      step: "freeze",
      at: stamp(),
      incidentId: incident.id,
      playbook: mitigated.body?.playbookExecution?.playbook ?? null,
      executed: mitigated.body?.playbookExecution?.executed ?? false,
      txHash: freezeTx,
      timeToFreezeMs: freezeMs,
      policyPausedOnchain: pausedAfterMitigate
    });

    // ------------------------------------------- 3. the same spend, now refused by the guard
    const refusedStarted = Date.now();
    const refusedTx = await execSafeTx(PAYROLL, DRILL_SPEND, { forceGas: FORCED_GAS_LIMIT });
    const { receipt: refusedReceipt, reverted } = await waitAllowingRevert(refusedTx);
    const refusedMs = since(refusedStarted);
    const refusedStatus = refusedReceipt?.status ?? null;
    if (!reverted) {
      throw new Error(
        `The spend settled while the policy was paused (${refusedTx.hash}). The freeze did not hold.`
      );
    }
    console.log(
      `\n  frozen refusal: ${refusedTx.hash} status ${refusedStatus} (${refusedMs}ms) — gas ${refusedReceipt?.gasUsed ?? "?"}`
    );
    steps.push({
      step: "refused-while-frozen",
      at: stamp(),
      txHash: refusedTx.hash,
      status: refusedStatus,
      gasUsed: refusedReceipt?.gasUsed?.toString() ?? null,
      elapsedMs: refusedMs,
      expected: "status 0 — SafeTreasuryGuard reverts with PolicyManagerPaused"
    });

    // ------------------------------------------------------------------ 4. operator unfreeze
    const unfreezeStarted = Date.now();
    const unfrozen = await post("/api/policy", { op: "unpause" });
    const unfreezeMs = since(unfreezeStarted);
    console.log(
      `\n  unfreeze: HTTP ${unfrozen.status} · ${unfrozen.body?.txHash ?? unfrozen.text.slice(0, 160)} in ${unfreezeMs}ms`
    );
    steps.push({
      step: "unfreeze",
      at: stamp(),
      txHash: unfrozen.body?.txHash ?? null,
      httpStatus: unfrozen.status,
      elapsedMs: unfreezeMs
    });
  } finally {
    // A drill that leaves the live lane frozen is worse than no drill.
    const stillPaused: boolean = await policy.paused();
    if (stillPaused) {
      console.log("\n  policy is still paused — clearing it directly from the operator key…");
      const tx = await policy.unpause();
      await tx.wait();
    }
    paused = await policy.paused();
  }

  // ------------------------------------------ 5. the lane is live again: the spend settles
  const settleStarted = Date.now();
  const settledTx = await execSafeTx(PAYROLL, DRILL_SPEND);
  const { receipt: settledReceipt } = await waitAllowingRevert(settledTx);
  const settledMs = since(settleStarted);
  console.log(
    `\n  post-drill spend: ${settledTx.hash} status ${settledReceipt?.status ?? "?"} (${settledMs}ms)`
  );
  steps.push({
    step: "settled-after-unfreeze",
    at: stamp(),
    txHash: settledTx.hash,
    status: settledReceipt?.status ?? null,
    gasUsed: settledReceipt?.gasUsed?.toString() ?? null,
    elapsedMs: settledMs
  });

  const after = await get("/api/kpi");
  const report = {
    ranAt: stamp(),
    network: record.network,
    chainId: record.chainId,
    api: API,
    policyManager: record.policyManager.address,
    safeTreasuryGuard: record.safeTreasuryGuard.address,
    safe: record.realSafe.address,
    operator: signer.address,
    outcome: {
      policyPausedOnchain: true,
      laneLeftPaused: paused,
      totalMs: since(startedAt)
    },
    kpi: { before, after },
    steps
  };

  const out = resolve(__dirname, "..", "evidence", "incident-drill.json");
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`\n  total drill time: ${(since(startedAt) / 1000).toFixed(1)}s`);
  console.log(`  live KPI after drill: assessments=${after.totalAssessments} blocked=${after.blockedCount} incidents=${after.incidentCount}`);
  console.log(`  wrote evidence/incident-drill.json`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
