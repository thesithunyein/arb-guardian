/**
 * Chain access for the app, built on `@arb-guardian/shared`.
 *
 * The ABI fragments that used to live here were one of three copies of the same knowledge;
 * they now come from the shared policy client, which the contracts test suite drives against
 * the real contracts.
 *
 * Note what this module deliberately does *not* do: it never assumes the deployment supports
 * the policy attestation. The live addresses run a build that predates it, so
 * `readAttestation` reports that as a fact about the deployment instead of throwing.
 */
import { JsonRpcProvider, formatEther, isAddress } from "ethers";
import {
  detectPolicyAttestation,
  executionGuard,
  policyManager,
  readPolicyRoles,
  readWalletPolicy,
  type PolicyAttestation,
  type PolicyRoles,
  type WalletPolicy
} from "@arb-guardian/shared";
import { EXECUTION_GUARD, POLICY_MANAGER, RPC_URL } from "./config";

export type OnchainPolicy = {
  allowlisted: boolean;
  dailyLimitWei: string;
  spentTodayWei: string;
  policyPaused: boolean;
  dailyLimitEth: string;
  spentTodayEth: string;
  source: "onchain";
};

let provider: JsonRpcProvider | null = null;

export function getReadProvider() {
  if (!provider) provider = new JsonRpcProvider(RPC_URL, 421614);
  return provider;
}

function configured() {
  return isAddress(POLICY_MANAGER) && isAddress(EXECUTION_GUARD);
}

/** Everything the Review tab needs about one wallet's exposure, read from the live chain. */
export async function readOnchainPolicy(
  wallet: string,
  destination: string
): Promise<OnchainPolicy | null> {
  if (!isAddress(wallet) || !isAddress(destination)) return null;
  if (!configured()) return null;

  const p = getReadProvider();
  const policy = policyManager(POLICY_MANAGER, p);
  const guard = executionGuard(EXECUTION_GUARD, p);

  const [allowlisted, walletPolicy, paused] = await Promise.all([
    policy.allowlistedCounterparty(destination),
    readWalletPolicy(policy, guard, wallet),
    policy.paused()
  ]);

  return {
    allowlisted: Boolean(allowlisted),
    dailyLimitWei: walletPolicy.dailyLimitWei.toString(),
    spentTodayWei: walletPolicy.spentTodayWei.toString(),
    policyPaused: Boolean(paused),
    dailyLimitEth: formatEther(walletPolicy.dailyLimitWei),
    spentTodayEth: formatEther(walletPolicy.spentTodayWei),
    source: "onchain"
  };
}

/** The wallet's full policy, for the console that administers it. */
export async function readPolicyFor(wallet: string): Promise<{
  policy: WalletPolicy;
  roles: PolicyRoles;
  attestation: PolicyAttestation;
  managerAddress: string;
} | null> {
  if (!isAddress(wallet) || !configured()) return null;

  const p = getReadProvider();
  const policy = policyManager(POLICY_MANAGER, p);
  const guard = executionGuard(EXECUTION_GUARD, p);

  const [walletPolicy, roles, attestation] = await Promise.all([
    readWalletPolicy(policy, guard, wallet),
    readPolicyRoles(policy, wallet),
    detectPolicyAttestation(policy)
  ]);

  return { policy: walletPolicy, roles, attestation, managerAddress: POLICY_MANAGER };
}

export async function pingRpc(): Promise<boolean> {
  try {
    await getReadProvider().getBlockNumber();
    return true;
  } catch {
    return false;
  }
}
