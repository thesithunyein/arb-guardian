export const POLICY_MANAGER_ABI = [
  "function allowlistedCounterparty(address) view returns (bool)",
  "function walletDailyLimitWei(address) view returns (uint256)",
  "function paused() view returns (bool)",
  "function pause()",
  "function unpause()"
] as const;

export const EXECUTION_GUARD_ABI = [
  "function walletSpentTodayWei(address) view returns (uint256)",
  "function validateAndRecord(address wallet, address destination, uint256 amountWei, bytes4 methodSelector) returns (bool allowed, string reason)",
  "event TransactionValidated(address indexed wallet, address indexed destination, uint256 amountWei, bytes4 methodSelector, bool blocked, string reason, address indexed actor)"
] as const;
