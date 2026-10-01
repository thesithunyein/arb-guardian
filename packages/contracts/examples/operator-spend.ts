import { ethers, network } from "hardhat";

/**
 * Operator integration example — how a bot spends through Arb Guardian.
 *
 *   npm run example:operator -w packages/contracts
 *
 * This is not a test and not the evidence pack. It is the shape of the code an agent, trading
 * bot or keeper would actually write: take a spend request, ask the policy before sending it,
 * and refuse to send anything the policy rejects.
 *
 * It runs against an in-process chain so it needs no keys, no RPC and no funding, and it exits
 * non-zero if a case stops behaving as specified, so CI can run it.
 *
 * Two things worth copying out of this file:
 *
 *   1. `propose()` dry-runs the policy with `staticCall` and decodes the custom error. That is
 *      how an operator gets a *reason* before spending, instead of a failed transaction after.
 *   2. Every allowed decision is stamped with the policy version and digest that judged it, taken
 *      from the emitted event. Store that pair next to your own order record and you can prove
 *      later which policy allowed the spend.
 *
 * One honest caveat, because it is the difference between this and real enforcement: an operator
 * holding the funds could skip this client entirely. ExecutionGuard is the pre-flight oracle for
 * a key you control. When the money is in a multisig, install `SafeTreasuryGuard` (see
 * `test/RealSafeGuard.test.ts`) and enforcement stops depending on the operator's good behaviour.
 */

const USDG_DECIMALS = 6n;
const usdg = (whole: number) => BigInt(whole) * 10n ** USDG_DECIMALS;

const TRANSFER_SELECTOR = "0xa9059cbb";
const APPROVE_SELECTOR = "0x095ea7b3";
/** A plain value transfer carries no calldata; the guard records the empty selector. */
const NO_CALLDATA_SELECTOR = "0x00000000";

type Decision = {
  allowed: boolean;
  /** Custom error signature when the policy refuses, e.g. `DailyLimitExceeded(...)`. */
  reason: string;
  policyVersion?: bigint;
  policyDigest?: string;
};

/** Pull the revert reason out of an ethers error and decode it against the guard's ABI. */
function decodePolicyError(guard: any, error: unknown): string {
  const raw = error as { data?: unknown; info?: { error?: { data?: unknown } }; error?: { data?: unknown } };
  const data = raw?.data ?? raw?.info?.error?.data ?? raw?.error?.data;
  if (typeof data === "string" && data.length > 2) {
    try {
      const parsed = guard.interface.parseError(data);
      if (parsed) {
        return `${parsed.name}(${parsed.args.map((arg: unknown) => String(arg)).join(", ")})`;
      }
    } catch {
      // Fall through to the raw message below.
    }
  }
  return error instanceof Error ? error.message.split("\n")[0].slice(0, 110) : String(error);
}

/** Read the policy stamp (version + digest) that a successful decision carried. */
function stampFromReceipt(guard: any, receipt: any, eventName: string): Pick<Decision, "policyVersion" | "policyDigest"> {
  for (const log of receipt.logs) {
    try {
      const parsed = guard.interface.parseLog(log);
      if (parsed?.name === eventName) {
        return { policyVersion: parsed.args.policyVersion, policyDigest: parsed.args.policyDigest };
      }
    } catch {
      // Not one of ours.
    }
  }
  return {};
}

/**
 * A minimal operator client. In production this would live next to the agent's order loop.
 */
class GuardedOperator {
  constructor(
    private readonly guard: any,
    private readonly wallet: string
  ) {}

  /** Native-asset spend: ask the policy, then send only if it says yes. */
  async proposeNative(destination: string, amountWei: bigint): Promise<Decision> {
    try {
      await this.guard.validateAndRecord.staticCall(this.wallet, destination, amountWei, NO_CALLDATA_SELECTOR);
    } catch (error) {
      return { allowed: false, reason: decodePolicyError(this.guard, error) };
    }

    const receipt = await (
      await this.guard.validateAndRecord(this.wallet, destination, amountWei, NO_CALLDATA_SELECTOR)
    ).wait();
    return { allowed: true, reason: "allowed", ...stampFromReceipt(this.guard, receipt, "TransactionValidated") };
  }

  /** Registered-token spend (e.g. USDG), amount in the token's own base units. */
  async proposeTokenTransfer(token: string, recipient: string, amount: bigint): Promise<Decision> {
    try {
      await this.guard.validateTokenTransfer.staticCall(this.wallet, token, recipient, amount, TRANSFER_SELECTOR);
    } catch (error) {
      return { allowed: false, reason: decodePolicyError(this.guard, error) };
    }

    const receipt = await (
      await this.guard.validateTokenTransfer(this.wallet, token, recipient, amount, TRANSFER_SELECTOR)
    ).wait();
    return { allowed: true, reason: "allowed", ...stampFromReceipt(this.guard, receipt, "TokenTransferValidated") };
  }

  /** Standing approval: the request an agent makes when it wants to trade on your behalf. */
  async proposeTokenApproval(token: string, spender: string, amount: bigint): Promise<Decision> {
    try {
      await this.guard.validateTokenApproval.staticCall(this.wallet, token, spender, amount, APPROVE_SELECTOR);
    } catch (error) {
      return { allowed: false, reason: decodePolicyError(this.guard, error) };
    }

    const receipt = await (
      await this.guard.validateTokenApproval(this.wallet, token, spender, amount, APPROVE_SELECTOR)
    ).wait();
    return { allowed: true, reason: "allowed", ...stampFromReceipt(this.guard, receipt, "TokenApprovalValidated") };
  }
}

type Scenario = {
  label: string;
  expect: "allowed" | "denied";
  /** Which key is asking. `unconfigured` is a key the policy has never seen. */
  operator?: "bot" | "unconfigured";
  run: (operator: GuardedOperator) => Promise<Decision>;
};

async function main() {
  const [admin, botKey, vendor, stranger, payroll, marketMaker, unconfiguredKey] = await ethers.getSigners();

  const policy = await (await ethers.getContractFactory("PolicyManager")).deploy(admin.address);
  await policy.waitForDeployment();
  const guard = await (await ethers.getContractFactory("ExecutionGuard")).deploy(admin.address, await policy.getAddress());
  await guard.waitForDeployment();
  const usdgToken = await (await ethers.getContractFactory("MockUSDG")).deploy();
  await usdgToken.waitForDeployment();
  const tokenAddress = await usdgToken.getAddress();

  // ---- The policy a treasury owner would configure: two lanes, both deny-by-default.
  await policy.setCounterparty(vendor.address, true);
  await policy.setWalletDailyLimit(botKey.address, ethers.parseEther("2")); // 2 ETH/day
  await policy.setTokenRegistered(tokenAddress, true);
  await policy.setTokenCounterparty(tokenAddress, payroll.address, true);
  await policy.setTokenCounterparty(tokenAddress, marketMaker.address, true);
  await policy.setTokenDailyLimit(tokenAddress, botKey.address, usdg(5000)); // 5,000 USDG/day

  const operator = new GuardedOperator(guard, botKey.address);
  const strangerOperator = new GuardedOperator(guard, unconfiguredKey.address);

  const scenarios: Scenario[] = [
    {
      label: "0.75 ETH → allowlisted vendor (inside the 2 ETH cap)",
      expect: "allowed",
      run: (op) => op.proposeNative(vendor.address, ethers.parseEther("0.75"))
    },
    {
      label: "0.10 ETH → address nobody allowlisted",
      expect: "denied",
      run: (op) => op.proposeNative(stranger.address, ethers.parseEther("0.1"))
    },
    {
      label: "1.50 ETH → allowlisted vendor (1.75 ETH already spent today)",
      expect: "denied",
      run: (op) => op.proposeNative(vendor.address, ethers.parseEther("1.5"))
    },
    {
      label: "1,200 USDG → allowlisted payroll (inside the 5,000 USDG cap)",
      expect: "allowed",
      run: (op) => op.proposeTokenTransfer(tokenAddress, payroll.address, usdg(1200))
    },
    {
      label: "6,000 USDG → allowlisted payroll (above the cap)",
      expect: "denied",
      run: (op) => op.proposeTokenTransfer(tokenAddress, payroll.address, usdg(6000))
    },
    {
      label: "unlimited USDG approval to a market maker",
      expect: "denied",
      run: (op) => op.proposeTokenApproval(tokenAddress, marketMaker.address, ethers.MaxUint256)
    },
    {
      label: "250 USDG approval to the same market maker (bounded)",
      expect: "allowed",
      run: (op) => op.proposeTokenApproval(tokenAddress, marketMaker.address, usdg(250))
    },
    {
      label: "0.01 ETH from a key the policy never configured",
      expect: "denied",
      operator: "unconfigured",
      run: (op) => op.proposeNative(vendor.address, ethers.parseEther("0.01"))
    }
  ];

  console.log(`\nOperator integration example on ${network.name}`);
  console.log(`  operator key   ${botKey.address}`);
  console.log(`  policy         ${await policy.getAddress()}`);
  console.log(`  guard          ${await guard.getAddress()}`);
  console.log(`  USDG-shaped    ${tokenAddress} (6 decimals, $5,000 daily cap)`);
  console.log("");

  const results: Array<{ scenario: Scenario; decision: Decision; ok: boolean }> = [];
  for (const scenario of scenarios) {
    const op = scenario.operator === "unconfigured" ? strangerOperator : operator;
    const decision = await scenario.run(op);
    results.push({ scenario, decision, ok: decision.allowed === (scenario.expect === "allowed") });
  }

  console.log("  #  spend                                                        decision  policy / reason");
  console.log("  -  ------------------------------------------------------------  --------  ---------------");
  results.forEach(({ scenario, decision }, index) => {
    const detail = decision.allowed
      ? `v${decision.policyVersion} ${String(decision.policyDigest).slice(0, 12)}…`
      : decision.reason;
    console.log(
      `  ${index + 1}  ${scenario.label.padEnd(60).slice(0, 60)}  ${(decision.allowed ? "ALLOWED" : "DENIED").padEnd(8)}  ${detail}`
    );
  });

  const allowed = results.filter((result) => result.decision.allowed).length;
  const misbehaved = results.filter((result) => !result.ok);
  console.log("");
  console.log(`  ${allowed}/${results.length} spends were allowed; policy refused ${results.length - allowed}.`);
  console.log(
    `  Policy version in force at the end: ${(await policy.policySnapshot())[0]}. ` +
      `Every ALLOWED row above is stamped with its version and digest.`
  );
  console.log("");

  if (misbehaved.length > 0) {
    for (const { scenario, decision } of misbehaved) {
      console.error(`  NOT AS SPECIFIED: ${scenario.label} — expected ${scenario.expect}, got ${JSON.stringify(decision)}`);
    }
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
