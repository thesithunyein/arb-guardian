import { expect } from "chai";
import { ethers } from "hardhat";

const TRANSFER = "0xa9059cbb";
const TRANSFER_FROM = "0x23b872dd";
const APPROVE = "0x095ea7b3";
const INCREASE_ALLOWANCE = "0x39509351";

const usdg = (whole: number) => BigInt(whole) * 10n ** 6n; // USDG uses 6 decimals

describe("ExecutionGuard token lane (USDG-shaped, 6 decimals)", function () {
  async function setup(opts: { registered?: boolean; recipientAllowed?: boolean; limit?: bigint } = {}) {
    const [admin, wallet, recipient, spender, outsider] = await ethers.getSigners();

    const tokenFactory = await ethers.getContractFactory("MockUSDG");
    const token = await tokenFactory.deploy();
    await token.waitForDeployment();

    const policyFactory = await ethers.getContractFactory("PolicyManager");
    const policy = await policyFactory.deploy(admin.address);
    await policy.waitForDeployment();

    if (opts.registered !== false) {
      await policy.setTokenRegistered(await token.getAddress(), true);
    }
    if (opts.recipientAllowed !== false) {
      await policy.setTokenCounterparty(await token.getAddress(), recipient.address, true);
      await policy.setTokenCounterparty(await token.getAddress(), spender.address, true);
    }
    await policy.setTokenDailyLimit(await token.getAddress(), wallet.address, opts.limit ?? usdg(5000));

    const guardFactory = await ethers.getContractFactory("ExecutionGuard");
    const guard = await guardFactory.deploy(admin.address, await policy.getAddress());
    await guard.waitForDeployment();

    const tokenAddress = await token.getAddress();
    return { admin, wallet, recipient, spender, outsider, token, tokenAddress, policy, guard };
  }

  it("allows an allowlisted recipient under the cap and records spend in token units", async function () {
    const { wallet, recipient, tokenAddress, guard } = await setup();

    await guard.validateTokenTransfer(wallet.address, tokenAddress, recipient.address, usdg(1000), TRANSFER);

    expect(await guard.walletTokenSpentToday(tokenAddress, wallet.address)).to.equal(usdg(1000));
  });

  it("accumulates spend across transfers and blocks once the cap is reached", async function () {
    const { wallet, recipient, tokenAddress, guard } = await setup({ limit: usdg(1500) });

    await guard.validateTokenTransfer(wallet.address, tokenAddress, recipient.address, usdg(1000), TRANSFER);

    await expect(
      guard.validateTokenTransfer(wallet.address, tokenAddress, recipient.address, usdg(600), TRANSFER)
    ).to.be.revertedWithCustomError(guard, "TokenDailyLimitExceeded");

    // The failed attempt must not have consumed any budget.
    expect(await guard.walletTokenSpentToday(tokenAddress, wallet.address)).to.equal(usdg(1000));
  });

  it("rejects a token that was never registered", async function () {
    const { wallet, recipient, tokenAddress, guard } = await setup({ registered: false });

    await expect(
      guard.validateTokenTransfer(wallet.address, tokenAddress, recipient.address, usdg(10), TRANSFER)
    ).to.be.revertedWithCustomError(guard, "TokenNotRegistered");
  });

  it("rejects a recipient that is not allowlisted for that token", async function () {
    const { wallet, outsider, tokenAddress, guard } = await setup();

    await expect(
      guard.validateTokenTransfer(wallet.address, tokenAddress, outsider.address, usdg(10), TRANSFER)
    ).to.be.revertedWithCustomError(guard, "TokenCounterpartyNotAllowlisted");
  });

  it("fails closed when no token limit is configured", async function () {
    const { wallet, recipient, tokenAddress, guard } = await setup({ limit: 0n });

    await expect(
      guard.validateTokenTransfer(wallet.address, tokenAddress, recipient.address, usdg(1), TRANSFER)
    ).to.be.revertedWithCustomError(guard, "TokenDailyLimitNotConfigured");
  });

  it("is unaffected by the native lane's own limit being unset", async function () {
    // A treasury that only holds USDG should not need a native ETH cap.
    const { wallet, recipient, tokenAddress, guard, policy } = await setup();

    expect(await policy.walletDailyLimitWei(wallet.address)).to.equal(0n);
    await guard.validateTokenTransfer(wallet.address, tokenAddress, recipient.address, usdg(100), TRANSFER);
    expect(await guard.walletTokenSpentToday(tokenAddress, wallet.address)).to.equal(usdg(100));
  });

  it("exposes the 18-vs-6 decimal trap: a wei-sized number blows the USDG cap", async function () {
    // This is the bug the old wei-denominated policy would have shipped: "$5,000" expressed
    // as 5e18 (18 decimals) is 5,000,000,000,000 in 6-decimal units — a million times too big.
    const { wallet, recipient, tokenAddress, guard } = await setup({ limit: usdg(5000) });

    const weiSizedAmount = ethers.parseEther("5000"); // 5e18
    expect(weiSizedAmount).to.be.greaterThan(usdg(5000));

    await expect(
      guard.validateTokenTransfer(wallet.address, tokenAddress, recipient.address, weiSizedAmount, TRANSFER)
    ).to.be.revertedWithCustomError(guard, "TokenDailyLimitExceeded");
  });

  it("treats transferFrom and transfer identically for cap purposes", async function () {
    const { wallet, recipient, tokenAddress, guard } = await setup({ limit: usdg(1000) });

    await guard.validateTokenTransfer(wallet.address, tokenAddress, recipient.address, usdg(900), TRANSFER_FROM);
    expect(await guard.walletTokenSpentToday(tokenAddress, wallet.address)).to.equal(usdg(900));

    await expect(
      guard.validateTokenTransfer(wallet.address, tokenAddress, recipient.address, usdg(200), TRANSFER)
    ).to.be.revertedWithCustomError(guard, "TokenDailyLimitExceeded");
  });

  it("resets token spend after a day rollover", async function () {
    const { wallet, recipient, tokenAddress, guard } = await setup({ limit: usdg(1000) });

    await guard.validateTokenTransfer(wallet.address, tokenAddress, recipient.address, usdg(1000), TRANSFER);

    await ethers.provider.send("evm_increaseTime", [24 * 60 * 60 + 10]);
    await ethers.provider.send("evm_mine", []);

    await guard.validateTokenTransfer(wallet.address, tokenAddress, recipient.address, usdg(500), TRANSFER);
    expect(await guard.walletTokenSpentToday(tokenAddress, wallet.address)).to.equal(usdg(500));
  });

  describe("approval lane", function () {
    it("allows a bounded approval to an allowlisted spender", async function () {
      const { wallet, spender, tokenAddress, guard } = await setup();

      await expect(guard.validateTokenApproval(wallet.address, tokenAddress, spender.address, usdg(500), APPROVE))
        .to.not.be.reverted;
      await expect(
        guard.validateTokenApproval(wallet.address, tokenAddress, spender.address, usdg(1), INCREASE_ALLOWANCE)
      ).to.not.be.reverted;
    });

    it("rejects an unlimited approval", async function () {
      const { wallet, spender, tokenAddress, guard } = await setup();

      await expect(
        guard.validateTokenApproval(wallet.address, tokenAddress, spender.address, ethers.MaxUint256, APPROVE)
      ).to.be.revertedWithCustomError(guard, "UnlimitedApprovalNotAllowed");
    });

    it("rejects a spender that is not allowlisted for that token", async function () {
      const { wallet, outsider, tokenAddress, guard } = await setup();

      await expect(
        guard.validateTokenApproval(wallet.address, tokenAddress, outsider.address, usdg(1), APPROVE)
      ).to.be.revertedWithCustomError(guard, "TokenCounterpartyNotAllowlisted");
    });

    it("does not consume the daily cap, because an approval grants authority rather than value", async function () {
      const { wallet, spender, recipient, tokenAddress, guard } = await setup({ limit: usdg(1000) });

      await guard.validateTokenApproval(wallet.address, tokenAddress, spender.address, usdg(1000), APPROVE);
      expect(await guard.walletTokenSpentToday(tokenAddress, wallet.address)).to.equal(0n);

      await guard.validateTokenTransfer(wallet.address, tokenAddress, recipient.address, usdg(1000), TRANSFER);
    });
  });

  it("enforces RBAC on the token lane", async function () {
    const { outsider, recipient, wallet, tokenAddress, guard } = await setup();

    await expect(
      guard
        .connect(outsider)
        .validateTokenTransfer(wallet.address, tokenAddress, recipient.address, usdg(1), TRANSFER)
    ).to.be.revertedWithCustomError(guard, "AccessControlUnauthorizedAccount");
  });
});
