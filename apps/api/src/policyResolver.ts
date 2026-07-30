import { getChainConfig, getGuardContract, getPolicyContract, isEthAddress } from "./chainClient.js";

export type ResolvedPolicyState = {
  allowlisted: boolean;
  dailyLimitWei: string;
  spentTodayWei: string;
  policyPaused: boolean;
  source: "onchain" | "request";
};

export async function resolvePolicyState(input: {
  wallet: string;
  destination: string;
  allowlisted?: boolean;
  dailyLimitWei?: string;
  spentTodayWei?: string;
}): Promise<ResolvedPolicyState> {
  const config = getChainConfig();
  const canUseChain =
    config && isEthAddress(input.wallet) && isEthAddress(input.destination);

  if (canUseChain) {
    const policy = getPolicyContract(config);
    const guard = getGuardContract(config);
    const [allowlisted, dailyLimitWei, spentTodayWei, policyPaused] = await Promise.all([
      policy.allowlistedCounterparty(input.destination),
      policy.walletDailyLimitWei(input.wallet),
      guard.walletSpentTodayWei(input.wallet),
      policy.paused()
    ]);

    return {
      allowlisted: Boolean(allowlisted),
      dailyLimitWei: dailyLimitWei.toString(),
      spentTodayWei: spentTodayWei.toString(),
      policyPaused: Boolean(policyPaused),
      source: "onchain"
    };
  }

  return {
    allowlisted: input.allowlisted ?? false,
    dailyLimitWei: input.dailyLimitWei ?? "0",
    spentTodayWei: input.spentTodayWei ?? "0",
    policyPaused: false,
    source: "request"
  };
}
