import { FunctionFragment } from "ethers";
import { getChainConfig, getGuardContract, getOperatorWallet, getPolicyContract } from "./chainClient.js";
import { createIncidentFromAssessment } from "./agentCoordinator.js";
import { assessTransaction } from "./riskEngine.js";
import { recordAssessment } from "./assessmentStore.js";
import { resolvePolicyState } from "./policyResolver.js";

export type ChainValidateResult = {
  onchain: {
    attempted: boolean;
    allowed: boolean;
    reason: string | null;
    txHash: string | null;
    reverted: boolean;
  };
  assessment: ReturnType<typeof assessTransaction>;
  incident: ReturnType<typeof createIncidentFromAssessment>;
};

export async function validateOnchain(input: {
  wallet: string;
  destination: string;
  method: string;
  amountWei: string;
  txHash: string;
}): Promise<ChainValidateResult> {
  const config = getChainConfig();
  const policyState = await resolvePolicyState({
    wallet: input.wallet,
    destination: input.destination
  });

  const assessment = assessTransaction({
    txHash: input.txHash,
    wallet: input.wallet,
    destination: input.destination,
    method: input.method,
    amountWei: BigInt(input.amountWei),
    allowlisted: policyState.allowlisted,
    dailyLimitWei: BigInt(policyState.dailyLimitWei),
    spentTodayWei: BigInt(policyState.spentTodayWei)
  });

  recordAssessment(assessment);

  const onchain = {
    attempted: false,
    allowed: false,
    reason: null as string | null,
    txHash: null as string | null,
    reverted: false
  };

  if (config) {
    const operator = getOperatorWallet(config);
    if (operator) {
      const guard = getGuardContract(config, operator);
      const methodSelector =
        input.method.toLowerCase() === "approve"
          ? FunctionFragment.from("approve(address,uint256)").selector
          : FunctionFragment.from("transfer(address,uint256)").selector;
      onchain.attempted = true;
      try {
        const tx = await guard.validateAndRecord(
          input.wallet,
          input.destination,
          BigInt(input.amountWei),
          methodSelector
        );
        const receipt = await tx.wait();
        onchain.txHash = receipt?.hash ?? tx.hash;
        onchain.allowed = true;
        onchain.reason = "allowed";
      } catch (error) {
        onchain.reverted = true;
        onchain.allowed = false;
        onchain.reason = error instanceof Error ? error.message : "validation_reverted";
      }
    }
  }

  const incident = createIncidentFromAssessment(assessment);
  return { onchain, assessment, incident };
}

export async function pausePolicyManager(): Promise<{ paused: boolean; txHash: string | null; error?: string }> {
  const config = getChainConfig();
  if (!config) return { paused: false, txHash: null, error: "chain_not_configured" };

  const operator = getOperatorWallet(config);
  if (!operator) return { paused: false, txHash: null, error: "operator_key_missing" };

  const policy = getPolicyContract(config, operator);
  const tx = await policy.pause();
  const receipt = await tx.wait();
  return { paused: true, txHash: receipt?.hash ?? tx.hash };
}

export async function syncBlockedEvents(sinceBlock = 0): Promise<{ imported: number; events: number }> {
  const config = getChainConfig();
  if (!config) return { imported: 0, events: 0 };

  const guard = getGuardContract(config);
  const filter = guard.filters.TransactionValidated();
  const events = await guard.queryFilter(filter, sinceBlock, "latest");

  let imported = 0;
  for (const event of events) {
    if (!("args" in event) || !event.args) continue;
    const blocked = Boolean(event.args.blocked);
    if (!blocked) continue;

    const wallet = String(event.args.wallet);
    const destination = String(event.args.destination);
    const amountWei = BigInt(event.args.amountWei);
    const reason = String(event.args.reason);
    const txHash = event.transactionHash;

    const policyState = await resolvePolicyState({ wallet, destination });
    const method = reason.includes("allowlist") ? "approve" : "transfer";

    const assessment = assessTransaction({
      txHash,
      wallet,
      destination,
      method,
      amountWei,
      allowlisted: policyState.allowlisted,
      dailyLimitWei: BigInt(policyState.dailyLimitWei),
      spentTodayWei: BigInt(policyState.spentTodayWei)
    });

    recordAssessment(assessment);
    const incident = createIncidentFromAssessment(assessment);
    if (incident) imported += 1;
  }

  return { imported, events: events.length };
}
