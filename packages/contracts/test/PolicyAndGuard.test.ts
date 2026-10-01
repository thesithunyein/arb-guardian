import { expect } from "chai";
import { ethers } from "hardhat";

describe("PolicyManager + ExecutionGuard", function () {
  it("allows valid transaction and records spend", async function () {
    const [admin, wallet, destination] = await ethers.getSigners();

    const policyFactory = await ethers.getContractFactory("PolicyManager");
    const policy = await policyFactory.deploy(admin.address);
    await policy.waitForDeployment();

    await policy.setCounterparty(destination.address, true);
    await policy.setWalletDailyLimit(wallet.address, ethers.parseEther("10"));

    const guardFactory = await ethers.getContractFactory("ExecutionGuard");
    const guard = await guardFactory.deploy(admin.address, await policy.getAddress());
    await guard.waitForDeployment();

    await expect(
      guard.validateAndRecord(wallet.address, destination.address, ethers.parseEther("1"), "0x12345678")
    ).to.emit(guard, "TransactionValidated");

    expect(await guard.walletSpentTodayWei(wallet.address)).to.equal(ethers.parseEther("1"));
  });

  it("reverts when destination is not allowlisted", async function () {
    const [admin, wallet, destination] = await ethers.getSigners();

    const policyFactory = await ethers.getContractFactory("PolicyManager");
    const policy = await policyFactory.deploy(admin.address);
    await policy.waitForDeployment();

    const guardFactory = await ethers.getContractFactory("ExecutionGuard");
    const guard = await guardFactory.deploy(admin.address, await policy.getAddress());
    await guard.waitForDeployment();

    await expect(
      guard.validateAndRecord(wallet.address, destination.address, ethers.parseEther("1"), "0x12345678")
    ).to.be.revertedWithCustomError(guard, "CounterpartyNotAllowlisted");
  });

  it("reverts when daily limit is exceeded", async function () {
    const [admin, wallet, destination] = await ethers.getSigners();

    const policyFactory = await ethers.getContractFactory("PolicyManager");
    const policy = await policyFactory.deploy(admin.address);
    await policy.waitForDeployment();
    await policy.setCounterparty(destination.address, true);
    await policy.setWalletDailyLimit(wallet.address, ethers.parseEther("2"));

    const guardFactory = await ethers.getContractFactory("ExecutionGuard");
    const guard = await guardFactory.deploy(admin.address, await policy.getAddress());
    await guard.waitForDeployment();

    await guard.validateAndRecord(wallet.address, destination.address, ethers.parseEther("1"), "0x12345678");

    await expect(
      guard.validateAndRecord(wallet.address, destination.address, ethers.parseEther("2"), "0x12345678")
    ).to.be.revertedWithCustomError(guard, "DailyLimitExceeded");
  });

  it("enforces RBAC for policy changes", async function () {
    const [admin, unauthorized, destination] = await ethers.getSigners();
    const policyFactory = await ethers.getContractFactory("PolicyManager");
    const policy = await policyFactory.deploy(admin.address);
    await policy.waitForDeployment();

    await expect(
      policy.connect(unauthorized).setCounterparty(destination.address, true)
    ).to.be.revertedWithCustomError(policy, "AccessControlUnauthorizedAccount");
  });

  it("reverts on zero addresses and zero amount", async function () {
    const [admin, wallet, destination] = await ethers.getSigners();
    const policyFactory = await ethers.getContractFactory("PolicyManager");
    const policy = await policyFactory.deploy(admin.address);
    await policy.waitForDeployment();

    await expect(policy.setCounterparty(ethers.ZeroAddress, true)).to.be.revertedWithCustomError(
      policy,
      "ZeroAddressNotAllowed"
    );

    const guardFactory = await ethers.getContractFactory("ExecutionGuard");
    const guard = await guardFactory.deploy(admin.address, await policy.getAddress());
    await guard.waitForDeployment();
    await policy.setCounterparty(destination.address, true);

    await expect(
      guard.validateAndRecord(wallet.address, destination.address, 0, "0x12345678")
    ).to.be.revertedWithCustomError(guard, "InvalidAmount");
  });

  it("reverts validation when policy manager is paused", async function () {
    const [admin, wallet, destination] = await ethers.getSigners();
    const policyFactory = await ethers.getContractFactory("PolicyManager");
    const policy = await policyFactory.deploy(admin.address);
    await policy.waitForDeployment();
    await policy.setCounterparty(destination.address, true);
    await policy.setWalletDailyLimit(wallet.address, ethers.parseEther("10"));
    await policy.pause();

    const guardFactory = await ethers.getContractFactory("ExecutionGuard");
    const guard = await guardFactory.deploy(admin.address, await policy.getAddress());
    await guard.waitForDeployment();

    await expect(
      guard.validateAndRecord(wallet.address, destination.address, ethers.parseEther("1"), "0x12345678")
    ).to.be.revertedWithCustomError(guard, "PolicyManagerPaused");
  });

  it("resets daily spend after day rollover", async function () {
    const [admin, wallet, destination] = await ethers.getSigners();
    const policyFactory = await ethers.getContractFactory("PolicyManager");
    const policy = await policyFactory.deploy(admin.address);
    await policy.waitForDeployment();
    await policy.setCounterparty(destination.address, true);
    await policy.setWalletDailyLimit(wallet.address, ethers.parseEther("100"));

    const guardFactory = await ethers.getContractFactory("ExecutionGuard");
    const guard = await guardFactory.deploy(admin.address, await policy.getAddress());
    await guard.waitForDeployment();

    await guard.validateAndRecord(wallet.address, destination.address, ethers.parseEther("1"), "0x12345678");
    expect(await guard.walletSpentTodayWei(wallet.address)).to.equal(ethers.parseEther("1"));

    await ethers.provider.send("evm_increaseTime", [24 * 60 * 60 + 10]);
    await ethers.provider.send("evm_mine", []);

    await guard.validateAndRecord(wallet.address, destination.address, ethers.parseEther("2"), "0x12345678");
    expect(await guard.walletSpentTodayWei(wallet.address)).to.equal(ethers.parseEther("2"));
  });

  describe("deny-by-default daily limit", function () {
    async function setupGuard(limit: bigint | null) {
      const [admin, wallet, destination] = await ethers.getSigners();
      const policyFactory = await ethers.getContractFactory("PolicyManager");
      const policy = await policyFactory.deploy(admin.address);
      await policy.waitForDeployment();
      await policy.setCounterparty(destination.address, true);
      if (limit !== null) {
        await policy.setWalletDailyLimit(wallet.address, limit);
      }

      const guardFactory = await ethers.getContractFactory("ExecutionGuard");
      const guard = await guardFactory.deploy(admin.address, await policy.getAddress());
      await guard.waitForDeployment();
      return { admin, wallet, destination, policy, guard };
    }

    it("blocks a wallet that has no limit configured at all", async function () {
      const { wallet, destination, guard } = await setupGuard(null);

      await expect(
        guard.validateAndRecord(wallet.address, destination.address, ethers.parseEther("1"), "0x12345678")
      ).to.be.revertedWithCustomError(guard, "DailyLimitNotConfigured");

      expect(await guard.walletSpentTodayWei(wallet.address)).to.equal(0n);
    });

    it("blocks a wallet whose limit was cleared back to zero", async function () {
      const { wallet, destination, policy, guard } = await setupGuard(ethers.parseEther("5"));

      await guard.validateAndRecord(wallet.address, destination.address, ethers.parseEther("1"), "0x12345678");
      expect(await guard.walletSpentTodayWei(wallet.address)).to.equal(ethers.parseEther("1"));

      await policy.setWalletDailyLimit(wallet.address, 0);

      await expect(
        guard.validateAndRecord(wallet.address, destination.address, ethers.parseEther("1"), "0x12345678")
      ).to.be.revertedWithCustomError(guard, "DailyLimitNotConfigured");
    });

    it("allows uncapped spending only when UNLIMITED_LIMIT is granted explicitly", async function () {
      const { wallet, destination, policy, guard } = await setupGuard(ethers.parseEther("1"));

      expect(await policy.UNLIMITED_LIMIT()).to.equal(ethers.MaxUint256);

      await policy.setWalletDailyLimit(wallet.address, await policy.UNLIMITED_LIMIT());
      await guard.validateAndRecord(wallet.address, destination.address, ethers.parseEther("1000000"), "0x12345678");

      expect(await guard.walletSpentTodayWei(wallet.address)).to.equal(ethers.parseEther("1000000"));
    });

    it("still blocks an unallowlisted destination even with an unlimited limit", async function () {
      const { wallet, policy, guard } = await setupGuard(ethers.parseEther("1"));
      const notAllowlisted = (await ethers.getSigners())[4];

      await policy.setWalletDailyLimit(wallet.address, await policy.UNLIMITED_LIMIT());

      await expect(
        guard.validateAndRecord(wallet.address, notAllowlisted.address, ethers.parseEther("1"), "0x12345678")
      ).to.be.revertedWithCustomError(guard, "CounterpartyNotAllowlisted");
    });
  });
});
