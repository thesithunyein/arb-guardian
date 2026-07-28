import { PendingTransaction } from "./riskEngine.js";

export type EvaluationScenario = {
  id: string;
  expectedBlocked: boolean;
  expectedPlaybook: string;
  tx: PendingTransaction;
};

export const evaluationScenarios: EvaluationScenario[] = [
  {
    id: "critical_non_allowlisted_approval",
    expectedBlocked: true,
    expectedPlaybook: "freeze-wallet-and-revoke-approvals",
    tx: {
      txHash: "0xscn1",
      wallet: "0xWalletA",
      destination: "0xDestinationA",
      method: "approve",
      amountWei: 9_000000000000000000n,
      allowlisted: false,
      dailyLimitWei: 2_000000000000000000n,
      spentTodayWei: 0n
    }
  },
  {
    id: "high_limit_exceed",
    expectedBlocked: false,
    expectedPlaybook: "request-secondary-signer-confirmation",
    tx: {
      txHash: "0xscn2",
      wallet: "0xWalletB",
      destination: "0xDestinationB",
      method: "transfer",
      amountWei: 4_000000000000000000n,
      allowlisted: true,
      dailyLimitWei: 3_000000000000000000n,
      spentTodayWei: 0n
    }
  },
  {
    id: "safe_transfer",
    expectedBlocked: false,
    expectedPlaybook: "allow-with-monitoring",
    tx: {
      txHash: "0xscn3",
      wallet: "0xWalletC",
      destination: "0xDestinationC",
      method: "transfer",
      amountWei: 1_000000000000000000n,
      allowlisted: true,
      dailyLimitWei: 5_000000000000000000n,
      spentTodayWei: 0n
    }
  }
];
