import { PendingTransaction } from "./riskEngine.js";

export type EvaluationScenario = {
  id: string;
  expectedBlocked: boolean;
  expectedPlaybook: string;
  tx: PendingTransaction;
};

const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const C = "0x3333333333333333333333333333333333333333";
const PAYROLL = "0x4444444444444444444444444444444444444444";
const UNLISTED = "0x5555555555555555555555555555555555555555";

export const evaluationScenarios: EvaluationScenario[] = [
  {
    id: "critical_non_allowlisted_approval",
    expectedBlocked: true,
    expectedPlaybook: "freeze-wallet-and-revoke-approvals",
    tx: {
      txHash: "0xscn1",
      wallet: A,
      destination: UNLISTED,
      method: "approve",
      amountWei: 9_000000000000000000n,
      allowlisted: false,
      dailyLimitWei: 2_000000000000000000n,
      spentTodayWei: 0n
    }
  },
  {
    id: "high_limit_exceed",
    expectedBlocked: true,
    expectedPlaybook: "hold-transaction-and-require-admin-review",
    tx: {
      txHash: "0xscn2",
      wallet: B,
      destination: PAYROLL,
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
      wallet: C,
      destination: PAYROLL,
      method: "transfer",
      amountWei: 1_000000000000000000n,
      allowlisted: true,
      dailyLimitWei: 5_000000000000000000n,
      spentTodayWei: 0n
    }
  },
  {
    id: "non_allowlisted_transfer",
    expectedBlocked: true,
    expectedPlaybook: "hold-transaction-and-require-admin-review",
    tx: {
      txHash: "0xscn4",
      wallet: B,
      destination: UNLISTED,
      method: "transfer",
      amountWei: 1_000000000000000000n,
      allowlisted: false,
      dailyLimitWei: 5_000000000000000000n,
      spentTodayWei: 0n
    }
  },
  {
    id: "limit_exceed_blocked",
    expectedBlocked: true,
    expectedPlaybook: "hold-transaction-and-require-admin-review",
    tx: {
      txHash: "0xscn5",
      wallet: A,
      destination: PAYROLL,
      method: "transfer",
      amountWei: 2_000000000000000000n,
      allowlisted: true,
      dailyLimitWei: 1_000000000000000000n,
      spentTodayWei: 1_000000000000000000n
    }
  },
  {
    id: "approve_allowlisted_medium",
    expectedBlocked: false,
    expectedPlaybook: "allow-with-monitoring",
    tx: {
      txHash: "0xscn6",
      wallet: C,
      destination: PAYROLL,
      method: "approve",
      amountWei: 1_000000000000000000n,
      allowlisted: true,
      dailyLimitWei: 5_000000000000000000n,
      spentTodayWei: 0n
    }
  },
  {
    id: "zero_risk_monitoring",
    expectedBlocked: false,
    expectedPlaybook: "allow-with-monitoring",
    tx: {
      txHash: "0xscn7",
      wallet: B,
      destination: PAYROLL,
      method: "transfer",
      amountWei: 500000000000000000n,
      allowlisted: true,
      dailyLimitWei: 3_000000000000000000n,
      spentTodayWei: 1_000000000000000000n
    }
  },
  {
    id: "critical_combo_approval_unlisted",
    expectedBlocked: true,
    expectedPlaybook: "freeze-wallet-and-revoke-approvals",
    tx: {
      txHash: "0xscn8",
      wallet: C,
      destination: UNLISTED,
      method: "approve",
      amountWei: 5_000000000000000000n,
      allowlisted: false,
      dailyLimitWei: 10_000000000000000000n,
      spentTodayWei: 0n
    }
  },
  {
    id: "high_spent_over_limit",
    expectedBlocked: true,
    expectedPlaybook: "hold-transaction-and-require-admin-review",
    tx: {
      txHash: "0xscn9",
      wallet: A,
      destination: PAYROLL,
      method: "transfer",
      amountWei: 1_000000000000000000n,
      allowlisted: true,
      dailyLimitWei: 2_000000000000000000n,
      spentTodayWei: 1_500000000000000000n
    }
  },
  {
    id: "blocked_unlisted_small",
    expectedBlocked: true,
    expectedPlaybook: "hold-transaction-and-require-admin-review",
    tx: {
      txHash: "0xscn10",
      wallet: B,
      destination: UNLISTED,
      method: "transfer",
      amountWei: 100000000000000000n,
      allowlisted: false,
      dailyLimitWei: 10_000000000000000000n,
      spentTodayWei: 0n
    }
  },
  {
    id: "safe_large_under_limit",
    expectedBlocked: false,
    expectedPlaybook: "allow-with-monitoring",
    tx: {
      txHash: "0xscn11",
      wallet: C,
      destination: PAYROLL,
      method: "transfer",
      amountWei: 4_000000000000000000n,
      allowlisted: true,
      dailyLimitWei: 5_000000000000000000n,
      spentTodayWei: 0n
    }
  },
  {
    id: "critical_limit_and_unlisted",
    expectedBlocked: true,
    expectedPlaybook: "freeze-wallet-and-revoke-approvals",
    tx: {
      txHash: "0xscn12",
      wallet: A,
      destination: UNLISTED,
      method: "transfer",
      amountWei: 3_000000000000000000n,
      allowlisted: false,
      dailyLimitWei: 1_000000000000000000n,
      spentTodayWei: 0n
    }
  }
];
