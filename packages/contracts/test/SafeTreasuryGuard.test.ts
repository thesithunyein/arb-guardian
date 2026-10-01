import { expect } from "chai";
import { ethers } from "hardhat";

describe("SafeTreasuryGuard", function () {
  async function setup() {
    const [admin, safe, outsider, vendor] = await ethers.getSigners();

    const policyFactory = await ethers.getContractFactory("PolicyManager");
    const policy = await policyFactory.deploy(admin.address);
    await policy.waitForDeployment();

    const guardFactory = await ethers.getContractFactory("SafeTreasuryGuard");
    const guard = await guardFactory.deploy(admin.address, await policy.getAddress());
    await guard.waitForDeployment();

    await guard.setSafeEnrollment(safe.address, true);
    await policy.setCounterparty(vendor.address, true);
    await policy.setWalletDailyLimit(safe.address, ethers.parseEther("5"));

    return { admin, safe, outsider, vendor, policy, guard };
  }

  it("allows enrolled Safe transfer to allowlisted vendor under limit", async function () {
    const { safe, vendor, guard } = await setup();
    const guardAsSafe = guard.connect(safe);

    await expect(
      guardAsSafe.checkTransaction(
        vendor.address,
        ethers.parseEther("1"),
        "0x",
        0,
        0,
        0,
        0,
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        "0x",
        safe.address
      )
    ).to.emit(guard, "SafeTxChecked");

    expect(await guard.safeSpentTodayWei(safe.address)).to.equal(ethers.parseEther("1"));
  });

  it("reverts unlisted counterparty for Safe tx", async function () {
    const { safe, outsider, guard } = await setup();
    const guardAsSafe = guard.connect(safe);

    await expect(
      guardAsSafe.checkTransaction(
        outsider.address,
        ethers.parseEther("1"),
        "0x",
        0,
        0,
        0,
        0,
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        "0x",
        safe.address
      )
    ).to.be.revertedWithCustomError(guard, "CounterpartyNotAllowlisted");
  });

  it("reverts when daily limit exceeded", async function () {
    const { safe, vendor, guard } = await setup();
    const guardAsSafe = guard.connect(safe);

    await expect(
      guardAsSafe.checkTransaction(
        vendor.address,
        ethers.parseEther("6"),
        "0x",
        0,
        0,
        0,
        0,
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        "0x",
        safe.address
      )
    ).to.be.revertedWithCustomError(guard, "DailyLimitExceeded");
  });

  it("rejects non-enrolled Safe and delegatecalls", async function () {
    const { safe, outsider, vendor, guard } = await setup();
    const asOutsider = guard.connect(outsider);

    await expect(
      asOutsider.checkTransaction(
        vendor.address,
        ethers.parseEther("1"),
        "0x",
        0,
        0,
        0,
        0,
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        "0x",
        outsider.address
      )
    ).to.be.revertedWithCustomError(guard, "SafeNotEnrolled");

    await expect(
      guard.connect(safe).checkTransaction(
        vendor.address,
        0,
        "0x12345678",
        1, // DelegateCall
        0,
        0,
        0,
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        "0x",
        safe.address
      )
    ).to.be.revertedWithCustomError(guard, "DelegateCallNotAllowed");
  });

  describe("deny-by-default daily limit", function () {
    it("blocks an enrolled Safe with no limit configured", async function () {
      const { admin, safe, vendor } = await setup();
      const policyFactory = await ethers.getContractFactory("PolicyManager");
      const policy = await policyFactory.deploy(admin.address);
      await policy.waitForDeployment();
      await policy.setCounterparty(vendor.address, true);
      // deliberately no setWalletDailyLimit for the Safe

      const guardFactory = await ethers.getContractFactory("SafeTreasuryGuard");
      const freshGuard = await guardFactory.deploy(admin.address, await policy.getAddress());
      await freshGuard.waitForDeployment();
      await freshGuard.setSafeEnrollment(safe.address, true);

      await expect(
        freshGuard.connect(safe).checkTransaction(
          vendor.address,
          ethers.parseEther("1"),
          "0x",
          0,
          0,
          0,
          0,
          ethers.ZeroAddress,
          ethers.ZeroAddress,
          "0x",
          safe.address
        )
      ).to.be.revertedWithCustomError(freshGuard, "DailyLimitNotConfigured");
    });

    it("allows uncapped spending only when UNLIMITED_LIMIT is granted explicitly", async function () {
      const { safe, vendor, policy, guard } = await setup();
      await policy.setWalletDailyLimit(safe.address, await policy.UNLIMITED_LIMIT());

      await expect(
        guard.connect(safe).checkTransaction(
          vendor.address,
          ethers.parseEther("1000000"),
          "0x",
          0,
          0,
          0,
          0,
          ethers.ZeroAddress,
          ethers.ZeroAddress,
          "0x",
          safe.address
        )
      ).to.emit(guard, "SafeTxChecked");

      expect(await guard.safeSpentTodayWei(safe.address)).to.equal(ethers.parseEther("1000000"));
    });
  });

  describe("spend refund on failed execution", function () {
    it("refunds the daily budget when the guarded transaction fails", async function () {
      const { safe, vendor, guard } = await setup();
      const guardAsSafe = guard.connect(safe);

      await guardAsSafe.checkTransaction(
        vendor.address,
        ethers.parseEther("1"),
        "0x",
        0,
        0,
        0,
        0,
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        "0x",
        safe.address
      );
      expect(await guard.safeSpentTodayWei(safe.address)).to.equal(ethers.parseEther("1"));
      expect(await guard.pendingSpendWei(safe.address)).to.equal(ethers.parseEther("1"));

      await expect(guardAsSafe.checkAfterExecution(ethers.ZeroHash, false)).to.emit(guard, "SafeSpendRefunded");

      expect(await guard.safeSpentTodayWei(safe.address)).to.equal(0n);
      expect(await guard.pendingSpendWei(safe.address)).to.equal(0n);
    });

    it("keeps the spend recorded when the transaction succeeds", async function () {
      const { safe, vendor, guard } = await setup();
      const guardAsSafe = guard.connect(safe);

      await guardAsSafe.checkTransaction(
        vendor.address,
        ethers.parseEther("1"),
        "0x",
        0,
        0,
        0,
        0,
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        "0x",
        safe.address
      );

      await expect(guardAsSafe.checkAfterExecution(ethers.ZeroHash, true)).to.not.emit(guard, "SafeSpendRefunded");

      expect(await guard.safeSpentTodayWei(safe.address)).to.equal(ethers.parseEther("1"));
      expect(await guard.pendingSpendWei(safe.address)).to.equal(0n);
    });

    it("does not refund a value-less call that fails", async function () {
      const { safe, vendor, guard } = await setup();
      const guardAsSafe = guard.connect(safe);

      await guardAsSafe.checkTransaction(
        vendor.address,
        0,
        "0x12345678",
        0,
        0,
        0,
        0,
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        "0x",
        safe.address
      );

      await guardAsSafe.checkAfterExecution(ethers.ZeroHash, false);
      expect(await guard.safeSpentTodayWei(safe.address)).to.equal(0n);
    });
  });
});
