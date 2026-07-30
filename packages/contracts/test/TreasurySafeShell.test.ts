import { expect } from "chai";
import { ethers } from "hardhat";

describe("TreasurySafeShell + SafeTreasuryGuard", function () {
  async function setup() {
    const [owner, outsider, vendor] = await ethers.getSigners();

    const policyFactory = await ethers.getContractFactory("PolicyManager");
    const policy = await policyFactory.deploy(owner.address);
    await policy.waitForDeployment();

    const guardFactory = await ethers.getContractFactory("SafeTreasuryGuard");
    const guard = await guardFactory.deploy(owner.address, await policy.getAddress());
    await guard.waitForDeployment();

    const shellFactory = await ethers.getContractFactory("TreasurySafeShell");
    const shell = await shellFactory.deploy(owner.address);
    await shell.waitForDeployment();

    await shell.setGuard(await guard.getAddress());
    await guard.setSafeEnrollment(await shell.getAddress(), true);
    await policy.setCounterparty(vendor.address, true);
    await policy.setWalletDailyLimit(await shell.getAddress(), ethers.parseEther("5"));

    await owner.sendTransaction({ to: await shell.getAddress(), value: ethers.parseEther("2") });

    return { owner, outsider, vendor, policy, guard, shell };
  }

  it("executes allowlisted transfer under daily limit", async function () {
    const { shell, vendor } = await setup();
    await expect(shell.execTransaction(vendor.address, ethers.parseEther("1"), "0x", 0)).to.emit(
      shell,
      "Executed"
    );
  });

  it("reverts unlisted counterparty via guard", async function () {
    const { shell, outsider, guard } = await setup();
    await expect(
      shell.execTransaction(outsider.address, ethers.parseEther("0.1"), "0x", 0)
    ).to.be.revertedWithCustomError(guard, "CounterpartyNotAllowlisted");
  });

  it("rejects non-owner exec", async function () {
    const { shell, outsider, vendor } = await setup();
    await expect(
      shell.connect(outsider).execTransaction(vendor.address, ethers.parseEther("0.1"), "0x", 0)
    ).to.be.revertedWithCustomError(shell, "NotOwner");
  });
});
