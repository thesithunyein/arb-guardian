import { Contract, JsonRpcProvider, formatEther, isAddress } from "ethers";
import { EXECUTION_GUARD, POLICY_MANAGER, RPC_URL } from "./config";

const POLICY_ABI = [
  "function allowlistedCounterparty(address) view returns (bool)",
  "function walletDailyLimitWei(address) view returns (uint256)",
  "function paused() view returns (bool)"
] as const;

const GUARD_ABI = [
  "function walletSpentTodayWei(address) view returns (uint256)"
] as const;

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

function getProvider() {
  if (!provider) provider = new JsonRpcProvider(RPC_URL, 421614);
  return provider;
}

export async function readOnchainPolicy(wallet: string, destination: string): Promise<OnchainPolicy | null> {
  if (!isAddress(wallet) || !isAddress(destination)) return null;
  if (!isAddress(POLICY_MANAGER) || !isAddress(EXECUTION_GUARD)) return null;

  const p = getProvider();
  const policy = new Contract(POLICY_MANAGER, POLICY_ABI, p);
  const guard = new Contract(EXECUTION_GUARD, GUARD_ABI, p);

  const [allowlisted, dailyLimitWei, spentTodayWei, policyPaused] = await Promise.all([
    policy.allowlistedCounterparty(destination),
    policy.walletDailyLimitWei(wallet),
    guard.walletSpentTodayWei(wallet),
    policy.paused()
  ]);

  return {
    allowlisted: Boolean(allowlisted),
    dailyLimitWei: dailyLimitWei.toString(),
    spentTodayWei: spentTodayWei.toString(),
    policyPaused: Boolean(policyPaused),
    dailyLimitEth: formatEther(dailyLimitWei),
    spentTodayEth: formatEther(spentTodayWei),
    source: "onchain"
  };
}

export async function pingRpc(): Promise<boolean> {
  try {
    await getProvider().getBlockNumber();
    return true;
  } catch {
    return false;
  }
}
