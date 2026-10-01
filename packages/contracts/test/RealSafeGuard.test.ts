import { expect } from "chai";
import { ethers } from "hardhat";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

/**
 * Integration test against real Gnosis Safe v1.4.1 contracts (not a shell).
 *
 * What this proves, end to end on the production integration path:
 *   1. SafeTreasuryGuard satisfies Safe 1.4.1's `setGuard` ERC-165 requirement (GS300).
 *   2. The guard is installed the only way a real Safe allows it: an owner-approved
 *      `execTransaction` that CALLS THE SAFE ITSELF (GuardManager `authorized` is
 *      self-call only). A bespoke shell cannot demonstrate this.
 *   3. Once installed, the guard vetoes real Safe transactions before they execute.
 *
 * Safe artifacts ship prebuilt in the npm package, so no Safe source is compiled here.
 */
const SAFE_ARTIFACTS = join(
  __dirname,
  "..",
  "node_modules",
  "@safe-global/safe-contracts",
  "build",
  "artifacts",
  "contracts"
);

function safeArtifact(relPath: string): { abi: unknown[]; bytecode: string } {
  const raw = JSON.parse(readFileSync(join(SAFE_ARTIFACTS, relPath), "utf8"));
  return { abi: raw.abi, bytecode: raw.bytecode };
}

const SAFE = safeArtifact("Safe.sol/Safe.json");
const PROXY_FACTORY = safeArtifact("proxies/SafeProxyFactory.sol/SafeProxyFactory.json");
const FALLBACK_HANDLER = safeArtifact(
  "handler/CompatibilityFallbackHandler.sol/CompatibilityFallbackHandler.json"
);

const safeInterface = new ethers.Interface(SAFE.abi as never);

/** ERC-20 calldata we hand to the real Safe, exactly as a wallet UI would. */
const erc20Interface = new ethers.Interface([
  "function transfer(address to, uint256 amount)",
  "function transferFrom(address from, address to, uint256 amount)",
  "function approve(address spender, uint256 amount)",
  "function increaseAllowance(address spender, uint256 amount)",
  "function mint(address to, uint256 amount)"
]);

/** USDG uses 6 decimals, so "$5,000" is 5_000e6 rather than 5e18. */
const usdgUnits = (whole: number) => BigInt(whole) * 10n ** 6n;

describe("SafeTreasuryGuard + real Gnosis Safe v1.4.1", function () {
  let saltNonce = 1n;

  /**
   * Execute a transaction from a real Safe using a pre-approved hash signature
   * (v == 1). This is the standard Safe flow for a 1-of-1 owner and avoids any
   * hand-rolled ECDSA encoding in the test.
   */
  async function execSafeTx(
    safe: any,
    owner: HardhatEthersSigner,
    to: string,
    value: bigint,
    data: string,
    options: { operation?: number; safeTxGas?: bigint; gasPrice?: bigint } = {}
  ) {
    const operation = options.operation ?? 0;
    const safeTxGas = options.safeTxGas ?? 0n;
    const gasPrice = options.gasPrice ?? 0n;

    const nonce = await safe.nonce();
    const txHash: string = await safe.getTransactionHash(
      to,
      value,
      data,
      operation,
      safeTxGas,
      0n,
      gasPrice,
      ethers.ZeroAddress,
      ethers.ZeroAddress,
      nonce
    );

    await (await safe.connect(owner).approveHash(txHash)).wait();

    // 65-byte pre-approved signature: owner (32) || 0 (32) || v = 1
    const signature = ethers.concat([
      ethers.zeroPadValue(owner.address, 32),
      ethers.ZeroHash,
      "0x01"
    ]);

    return safe
      .connect(owner)
      .execTransaction(to, value, data, operation, safeTxGas, 0n, gasPrice, ethers.ZeroAddress, ethers.ZeroAddress, signature);
  }

  async function setup() {
    const [admin, owner, vendor, outsider] = await ethers.getSigners();

    // --- real Safe infrastructure ---
    const singleton = await new ethers.ContractFactory(SAFE.abi as never, SAFE.bytecode, admin).deploy();
    await singleton.waitForDeployment();

    const proxyFactory = await new ethers.ContractFactory(
      PROXY_FACTORY.abi as never,
      PROXY_FACTORY.bytecode,
      admin
    ).deploy();
    await proxyFactory.waitForDeployment();

    const fallbackHandler = await new ethers.ContractFactory(
      FALLBACK_HANDLER.abi as never,
      FALLBACK_HANDLER.bytecode,
      admin
    ).deploy();
    await fallbackHandler.waitForDeployment();

    const setupData = safeInterface.encodeFunctionData("setup", [
      [owner.address],
      1n,
      ethers.ZeroAddress,
      "0x",
      await fallbackHandler.getAddress(),
      ethers.ZeroAddress,
      0n,
      ethers.ZeroAddress
    ]);

    const proxyTx = await proxyFactory.createProxyWithNonce(
      await singleton.getAddress(),
      setupData,
      saltNonce++
    );
    const proxyReceipt = await proxyTx.wait();

    let safeAddress: string | undefined;
    for (const log of proxyReceipt!.logs) {
      try {
        const parsed = proxyFactory.interface.parseLog(log as never);
        if (parsed?.name === "ProxyCreation") {
          safeAddress = parsed.args[0];
        }
      } catch {
        /* not our event */
      }
    }
    if (!safeAddress) throw new Error("ProxyCreation event not found");

    const safe = new ethers.Contract(safeAddress, SAFE.abi as never, owner);

    // --- Arb Guardian policy + guard ---
    const policyFactory = await ethers.getContractFactory("PolicyManager");
    const policy = await policyFactory.deploy(admin.address);
    await policy.waitForDeployment();

    const guardFactory = await ethers.getContractFactory("SafeTreasuryGuard");
    const guard = await guardFactory.deploy(admin.address, await policy.getAddress());
    await guard.waitForDeployment();

    // Enroll and configure BEFORE installing the guard, since every later Safe
    // transaction will be checked by it.
    await guard.setSafeEnrollment(safeAddress, true);
    await policy.setCounterparty(vendor.address, true);
    await policy.setWalletDailyLimit(safeAddress, ethers.parseEther("5"));

    // Fund the Safe so guarded transfers can actually settle.
    await admin.sendTransaction({ to: safeAddress, value: ethers.parseEther("10") });

    // --- USDG-shaped token lane (6 decimals) ---
    const allSigners = await ethers.getSigners();
    const usdgRecipient = allSigners[4];
    const usdgSpender = allSigners[5];
    const usdgOutsider = allSigners[6];

    const usdgFactory = await ethers.getContractFactory("MockUSDG");
    const usdg = await usdgFactory.deploy();
    await usdg.waitForDeployment();
    const usdgAddress = await usdg.getAddress();

    await policy.setTokenRegistered(usdgAddress, true);
    await policy.setTokenCounterparty(usdgAddress, usdgRecipient.address, true);
    await policy.setTokenCounterparty(usdgAddress, usdgSpender.address, true);
    await policy.setTokenDailyLimit(usdgAddress, safeAddress, usdgUnits(5000));

    // Give the real Safe a USDG treasury.
    await usdg.mint(safeAddress, usdgUnits(100000));

    return {
      admin,
      owner,
      vendor,
      outsider,
      safe,
      safeAddress,
      policy,
      guard,
      usdg,
      usdgAddress,
      usdgRecipient,
      usdgSpender,
      usdgOutsider
    };
  }

  /** Install the guard the ONLY way Safe 1.4.1 permits: a self-call via execTransaction. */
  async function installGuard(ctx: Awaited<ReturnType<typeof setup>>) {
    const data = safeInterface.encodeFunctionData("setGuard", [await ctx.guard.getAddress()]);
    await (await execSafeTx(ctx.safe, ctx.owner, ctx.safeAddress, 0n, data)).wait();
  }

  it("installs SafeTreasuryGuard through a genuine Safe execTransaction self-call", async function () {
    const ctx = await setup();
    const data = safeInterface.encodeFunctionData("setGuard", [await ctx.guard.getAddress()]);

    // `getGuard()` is internal in Safe 1.4.1, so installation is asserted from the
    // ChangedGuard event emitted by GuardManager on the real Safe.
    await expect(execSafeTx(ctx.safe, ctx.owner, ctx.safeAddress, 0n, data))
      .to.emit(ctx.safe, "ChangedGuard")
      .withArgs(await ctx.guard.getAddress());
  });

  it("shows the before/after: an unsafe spend succeeds with no guard, and is blocked once installed", async function () {
    const ctx = await setup();

    // BEFORE — no guard installed on the real Safe, so the exact spend below settles.
    await (
      await execSafeTx(ctx.safe, ctx.owner, ctx.outsider.address, ethers.parseEther("1"), "0x")
    ).wait();
    expect(await ethers.provider.getBalance(ctx.outsider.address)).to.be.greaterThan(0n);

    // Install the guard the canonical way.
    await installGuard(ctx);

    // AFTER — the same class of spend is now vetoed before it can execute.
    await expect(
      execSafeTx(ctx.safe, ctx.owner, ctx.outsider.address, ethers.parseEther("1"), "0x")
    ).to.be.revertedWithCustomError(ctx.guard, "CounterpartyNotAllowlisted");
  });

  it("rejects a direct setGuard call from the owner (proves the real Safe path is required)", async function () {
    const ctx = await setup();

    // GuardManager in 1.4.1 is SelfAuthorized: only the Safe itself may set its guard.
    await expect(
      ctx.safe.connect(ctx.owner).setGuard(await ctx.guard.getAddress())
    ).to.be.reverted;
  });

  it("satisfies the Guard interface Safe 1.4.1 requires on setGuard", async function () {
    const { guard } = await setup();

    // type(Guard).interfaceId = checkTransaction ^ checkAfterExecution
    const interfaceId = BigInt(ethers.id(
      "checkTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes,address)"
    ).slice(0, 10)) ^ BigInt(ethers.id("checkAfterExecution(bytes32,bool)").slice(0, 10));

    expect(await guard.supportsInterface(ethers.toBeHex(interfaceId, 4))).to.equal(true);
    expect(await guard.supportsInterface("0x01ffc9a7")).to.equal(true); // IERC165
  });

  it("allows an allowlisted vendor transfer under the limit and records the spend", async function () {
    const ctx = await setup();
    await installGuard(ctx);

    await (await execSafeTx(ctx.safe, ctx.owner, ctx.vendor.address, ethers.parseEther("1"), "0x")).wait();

    expect(await ctx.guard.safeSpentTodayWei(ctx.safeAddress)).to.equal(ethers.parseEther("1"));
    expect(await ethers.provider.getBalance(ctx.vendor.address)).to.be.greaterThan(0n);
  });

  it("BLOCKS a non-allowlisted spend from a real Safe", async function () {
    const ctx = await setup();
    await installGuard(ctx);

    await expect(
      execSafeTx(ctx.safe, ctx.owner, ctx.outsider.address, ethers.parseEther("1"), "0x")
    ).to.be.revertedWithCustomError(ctx.guard, "CounterpartyNotAllowlisted");
  });

  it("BLOCKS a spend that would exceed the daily limit", async function () {
    const ctx = await setup();
    await installGuard(ctx);

    await expect(
      execSafeTx(ctx.safe, ctx.owner, ctx.vendor.address, ethers.parseEther("6"), "0x")
    ).to.be.revertedWithCustomError(ctx.guard, "DailyLimitExceeded");
  });

  it("BLOCKS everything after an officer freezes the policy manager", async function () {
    const ctx = await setup();
    await installGuard(ctx);

    // Prove the path works first, then freeze.
    await (await execSafeTx(ctx.safe, ctx.owner, ctx.vendor.address, ethers.parseEther("1"), "0x")).wait();
    await ctx.policy.pause();

    await expect(
      execSafeTx(ctx.safe, ctx.owner, ctx.vendor.address, ethers.parseEther("1"), "0x")
    ).to.be.revertedWithCustomError(ctx.guard, "PolicyManagerPaused");
  });

  it("BLOCKS an enrolled Safe with no limit configured (deny by default)", async function () {
    const ctx = await setup();
    await ctx.policy.setWalletDailyLimit(ctx.safeAddress, 0);
    await installGuard(ctx);

    await expect(
      execSafeTx(ctx.safe, ctx.owner, ctx.vendor.address, ethers.parseEther("1"), "0x")
    ).to.be.revertedWithCustomError(ctx.guard, "DailyLimitNotConfigured");
  });

  it("allows a large transfer once UNLIMITED_LIMIT is granted explicitly", async function () {
    const ctx = await setup();
    await ctx.policy.setWalletDailyLimit(ctx.safeAddress, await ctx.policy.UNLIMITED_LIMIT());
    await installGuard(ctx);

    await (
      await execSafeTx(ctx.safe, ctx.owner, ctx.vendor.address, ethers.parseEther("9"), "0x")
    ).wait();

    expect(await ctx.guard.safeSpentTodayWei(ctx.safeAddress)).to.equal(ethers.parseEther("9"));
  });

  it("BLOCKS a delegatecall operation", async function () {
    const ctx = await setup();
    await installGuard(ctx);

    await expect(
      execSafeTx(ctx.safe, ctx.owner, ctx.vendor.address, 0n, "0x12345678", { operation: 1 })
    ).to.be.revertedWithCustomError(ctx.guard, "DelegateCallNotAllowed");
  });

  it("records no spend when the whole Safe transaction reverts", async function () {
    const ctx = await setup();
    await installGuard(ctx);

    // Non-allowlisted destination: the guard vetoes, so nothing is ever recorded.
    await expect(
      execSafeTx(ctx.safe, ctx.owner, ctx.outsider.address, ethers.parseEther("1"), "0x")
    ).to.be.reverted;

    expect(await ctx.guard.safeSpentTodayWei(ctx.safeAddress)).to.equal(0n);
    expect(await ctx.guard.pendingSpendWei(ctx.safeAddress)).to.equal(0n);
  });

  describe("USDG-shaped token policy on a real Safe", function () {
    it("lets the Safe pay an allowlisted recipient and records spend in token units", async function () {
      const ctx = await setup();
      await installGuard(ctx);

      const data = erc20Interface.encodeFunctionData("transfer", [ctx.usdgRecipient.address, usdgUnits(1200)]);
      await (await execSafeTx(ctx.safe, ctx.owner, ctx.usdgAddress, 0n, data)).wait();

      expect(await ctx.usdg.balanceOf(ctx.usdgRecipient.address)).to.equal(usdgUnits(1200));
      expect(await ctx.guard.safeTokenSpentToday(ctx.usdgAddress, ctx.safeAddress)).to.equal(usdgUnits(1200));
      // The native lane stayed untouched — a token transfer is not native spend.
      expect(await ctx.guard.safeSpentTodayWei(ctx.safeAddress)).to.equal(0n);
    });

    it("BLOCKS a USDG payment to a recipient that is not allowlisted for the token", async function () {
      const ctx = await setup();
      await installGuard(ctx);

      const data = erc20Interface.encodeFunctionData("transfer", [ctx.usdgOutsider.address, usdgUnits(1)]);

      await expect(
        execSafeTx(ctx.safe, ctx.owner, ctx.usdgAddress, 0n, data)
      ).to.be.revertedWithCustomError(ctx.guard, "TokenCounterpartyNotAllowlisted");
    });

    it("BLOCKS a USDG payment that would exceed the token daily cap", async function () {
      const ctx = await setup();
      await installGuard(ctx);

      const data = erc20Interface.encodeFunctionData("transfer", [ctx.usdgRecipient.address, usdgUnits(6000)]);

      await expect(
        execSafeTx(ctx.safe, ctx.owner, ctx.usdgAddress, 0n, data)
      ).to.be.revertedWithCustomError(ctx.guard, "TokenDailyLimitExceeded");
    });

    it("BLOCKS an unlimited USDG approval from the treasury", async function () {
      const ctx = await setup();
      await installGuard(ctx);

      const data = erc20Interface.encodeFunctionData("approve", [ctx.usdgSpender.address, ethers.MaxUint256]);

      await expect(
        execSafeTx(ctx.safe, ctx.owner, ctx.usdgAddress, 0n, data)
      ).to.be.revertedWithCustomError(ctx.guard, "UnlimitedApprovalNotAllowed");
    });

    it("allows a bounded USDG approval to an allowlisted spender", async function () {
      const ctx = await setup();
      await installGuard(ctx);

      const data = erc20Interface.encodeFunctionData("approve", [ctx.usdgSpender.address, usdgUnits(250)]);
      await (await execSafeTx(ctx.safe, ctx.owner, ctx.usdgAddress, 0n, data)).wait();

      expect(await ctx.usdg.allowance(ctx.safeAddress, ctx.usdgSpender.address)).to.equal(usdgUnits(250));
      // An approval grants authority, so it does not consume the daily cap.
      expect(await ctx.guard.safeTokenSpentToday(ctx.usdgAddress, ctx.safeAddress)).to.equal(0n);
    });

    it("BLOCKS an unrecognised call on a registered token instead of falling through", async function () {
      const ctx = await setup();
      await installGuard(ctx);

      // `mint` is a valid function on the token but not a recognised treasury operation.
      const data = erc20Interface.encodeFunctionData("mint", [ctx.usdgOutsider.address, usdgUnits(1)]);

      await expect(
        execSafeTx(ctx.safe, ctx.owner, ctx.usdgAddress, 0n, data)
      ).to.be.revertedWithCustomError(ctx.guard, "UnsupportedTokenCall");
    });

    it("refunds the token budget when the USDG transfer fails on execution", async function () {
      const ctx = await setup();
      await installGuard(ctx);

      // The guard's own policy checks pass (allowlisted recipient, inside the cap), but the
      // token call then fails: the Safe holds no allowance over the outsider's USDG.
      //
      // gasPrice is non-zero so the Safe settles with success = false instead of reverting
      // the whole transaction (Safe reverts with GS013 when the inner call fails and both
      // safeTxGas and gasPrice are zero). That settled-but-failed case is precisely what
      // checkAfterExecution has to clean up after.
      const data = erc20Interface.encodeFunctionData("transferFrom", [
        ctx.usdgOutsider.address,
        ctx.usdgRecipient.address,
        usdgUnits(900)
      ]);

      const receipt = await (
        await execSafeTx(ctx.safe, ctx.owner, ctx.usdgAddress, 0n, data, { gasPrice: 1n })
      ).wait();
      expect(receipt!.status).to.equal(1);

      expect(await ctx.usdg.balanceOf(ctx.usdgRecipient.address)).to.equal(0n);
      expect(await ctx.guard.safeTokenSpentToday(ctx.usdgAddress, ctx.safeAddress)).to.equal(0n);
      expect(await ctx.guard.pendingTokenSpend(ctx.safeAddress)).to.equal(0n);
    });

    it("still enforces the token lane after an officer freeze", async function () {
      const ctx = await setup();
      await installGuard(ctx);
      await ctx.policy.pause();

      const data = erc20Interface.encodeFunctionData("transfer", [ctx.usdgRecipient.address, usdgUnits(1)]);

      await expect(
        execSafeTx(ctx.safe, ctx.owner, ctx.usdgAddress, 0n, data)
      ).to.be.revertedWithCustomError(ctx.guard, "PolicyManagerPaused");
    });
  });
});
