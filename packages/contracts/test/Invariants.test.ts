import { expect } from "chai";
import { ethers } from "hardhat";

/**
 * Invariants: the promises the policy makes that must hold for *every* sequence of calls, not the
 * ones a hand-written example happens to cover.
 *
 * The unit tests elsewhere check that a specific spend is allowed or refused. That leaves the
 * interesting failures untouched — a spend that is double-counted, a bucket that resets when it
 * should not, a lane that leaks into another, an approval that slips past a cap it should respect.
 * So each test here drives the contract with a deterministic pseudo-random sequence and asserts the
 * promise after every step.
 *
 * The generator is seeded and the seed is in the test, so a failure is reproducible rather than
 * "sometimes red in CI".
 */

/** Linear congruential generator — deterministic, and small enough to read. */
function generator(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

async function deployStack() {
  const [admin, wallet, payee, other] = await ethers.getSigners();

  const policyFactory = await ethers.getContractFactory("PolicyManager");
  const policy = await policyFactory.deploy(admin.address);
  await policy.waitForDeployment();

  const guardFactory = await ethers.getContractFactory("ExecutionGuard");
  const guard = await guardFactory.deploy(admin.address, await policy.getAddress());
  await guard.waitForDeployment();

  const tokenFactory = await ethers.getContractFactory("MockUSDG");
  const token = await tokenFactory.deploy();
  await token.waitForDeployment();

  return { admin, wallet, payee, other, policy, guard, token };
}

describe("policy invariants", function () {
  it("never lets a wallet spend past its cap, and never loses or double-counts a wei", async function () {
    const { wallet, payee, policy, guard } = await deployStack();
    const cap = ethers.parseEther("10");

    await policy.setCounterparty(payee.address, true);
    await policy.setWalletDailyLimit(wallet.address, cap);

    const next = generator(0x5eed);
    let creditedToday = 0n;
    let dayIndex = await guard.walletSpentDayIndex(wallet.address);
    let allowed = 0;
    let refused = 0;

    for (let step = 0; step < 120; step += 1) {
      // Amounts spread either side of a typical remainder, so the sequence keeps hitting the edge.
      const amount = ethers.parseEther((next() * 1.6).toFixed(6));
      if (amount === 0n) continue;

      try {
        await guard.validateAndRecord(wallet.address, payee.address, amount, "0x12345678");
        // A successful spend may be the first of a new UTC day, which resets the bucket. Mirror
        // that here rather than pretending the boundary cannot be crossed mid-test.
        const after = await guard.walletSpentDayIndex(wallet.address);
        if (after !== dayIndex) {
          dayIndex = after;
          creditedToday = 0n;
        }
        creditedToday += amount;
        allowed += 1;
      } catch {
        refused += 1;
      }

      const recorded = await guard.walletSpentTodayWei(wallet.address);
      // The ceiling holds after every step, which is the whole promise.
      expect(recorded, `step ${step}: recorded spend passed the cap`).to.be.at.most(cap);
      // And the bucket is exactly the sum of what was credited to it — no dropped or doubled wei.
      expect(recorded, `step ${step}: the recorded spend is not the sum of the allowed spends`).to.equal(
        creditedToday
      );
    }

    // The sequence has to actually exercise both outcomes, or it proves nothing.
    expect(allowed, "no spend was ever allowed").to.be.greaterThan(0);
    expect(refused, "the cap was never reached, so the ceiling was never tested").to.be.greaterThan(0);
    expect(creditedToday).to.be.at.most(cap);
  });

  it("is absolute when the cap is zero, whether it was never set or cleared", async function () {
    const { wallet, payee, policy, guard } = await deployStack();
    await policy.setCounterparty(payee.address, true);

    // Never configured.
    await expect(
      guard.validateAndRecord(wallet.address, payee.address, 1n, "0x12345678")
    ).to.be.revertedWithCustomError(guard, "DailyLimitNotConfigured");
    expect(await guard.walletSpentTodayWei(wallet.address)).to.equal(0n);

    // Configured, used, then cleared back to zero. Clearing must close the lane, not open it.
    await policy.setWalletDailyLimit(wallet.address, ethers.parseEther("5"));
    await guard.validateAndRecord(wallet.address, payee.address, 1000n, "0x12345678");
    await policy.setWalletDailyLimit(wallet.address, 0n);

    await expect(
      guard.validateAndRecord(wallet.address, payee.address, 1n, "0x12345678")
    ).to.be.revertedWithCustomError(guard, "DailyLimitNotConfigured");
    expect(await guard.walletSpentTodayWei(wallet.address)).to.equal(1000n);
  });

  it("treats only the explicit sentinel as uncapped, and caps one wei below it", async function () {
    const { wallet, payee, policy, guard } = await deployStack();
    await policy.setCounterparty(payee.address, true);

    // Read the sentinel from the contract so this cannot drift from the source.
    const unlimited = (await policy.UNLIMITED_LIMIT()) as bigint;
    expect(unlimited).to.equal((1n << 256n) - 1n);

    // One wei below the sentinel is still a cap.
    await policy.setWalletDailyLimit(wallet.address, unlimited - 1n);
    await guard.validateAndRecord(wallet.address, payee.address, unlimited - 1n, "0x12345678");
    await expect(
      guard.validateAndRecord(wallet.address, payee.address, 1n, "0x12345678")
    ).to.be.revertedWithCustomError(guard, "DailyLimitExceeded");

    // The sentinel itself permits spending past that point.
    await policy.setWalletDailyLimit(wallet.address, unlimited);
    await expect(guard.validateAndRecord(wallet.address, payee.address, 1n, "0x12345678")).to.not.be.reverted;
  });

  it("refuses every lane while the policy is frozen, and restores them on unfreeze", async function () {
    const { wallet, payee, policy, guard, token } = await deployStack();
    const tokenAddress = await token.getAddress();

    await policy.setCounterparty(payee.address, true);
    await policy.setWalletDailyLimit(wallet.address, ethers.parseEther("5"));
    await policy.setTokenRegistered(tokenAddress, true);
    await policy.setTokenCounterparty(tokenAddress, payee.address, true);
    await policy.setTokenDailyLimit(tokenAddress, wallet.address, 5_000_000n);

    await guard.validateAndRecord(wallet.address, payee.address, 1000n, "0x12345678");
    await guard.validateTokenTransfer(wallet.address, tokenAddress, payee.address, 1000n, "0xa9059cbb");

    await policy.pause();

    // Every lane, and the amounts that would otherwise be fine.
    await expect(
      guard.validateAndRecord(wallet.address, payee.address, 1n, "0x12345678")
    ).to.be.revertedWithCustomError(guard, "PolicyManagerPaused");
    await expect(
      guard.validateTokenTransfer(wallet.address, tokenAddress, payee.address, 1n, "0xa9059cbb")
    ).to.be.revertedWithCustomError(guard, "PolicyManagerPaused");
    await expect(
      guard.validateTokenApproval(wallet.address, tokenAddress, payee.address, 1n, "0x095ea7b3")
    ).to.be.revertedWithCustomError(guard, "PolicyManagerPaused");

    // A freeze is also not a way to reset the day's usage.
    expect(await guard.walletSpentTodayWei(wallet.address)).to.equal(1000n);

    await policy.unpause();
    await expect(guard.validateAndRecord(wallet.address, payee.address, 1n, "0x12345678")).to.not.be.reverted;
  });

  it("refuses an unlimited approval under every policy setting, and pins what a bounded one grants", async function () {
    const { wallet, payee, policy, guard, token } = await deployStack();
    const tokenAddress = await token.getAddress();
    const max = (1n << 256n) - 1n;

    await policy.setTokenRegistered(tokenAddress, true);
    await policy.setTokenCounterparty(tokenAddress, payee.address, true);
    await policy.setTokenDailyLimit(tokenAddress, wallet.address, 5_000_000n);

    // The classic drain primitive: never, at any cap.
    await expect(
      guard.validateTokenApproval(wallet.address, tokenAddress, payee.address, max, "0x095ea7b3")
    ).to.be.revertedWithCustomError(guard, "UnlimitedApprovalNotAllowed");

    // A spender cleared on one token is not cleared on another.
    await expect(
      guard.validateTokenApproval(wallet.address, tokenAddress, wallet.address, 250n, "0x095ea7b3")
    ).to.be.revertedWithCustomError(guard, "TokenCounterpartyNotAllowlisted");

    await guard.validateTokenApproval(wallet.address, tokenAddress, payee.address, 250n, "0x095ea7b3");

    // Pinned, because it is a limit of the design rather than an accident: an approval is standing
    // authority, not a movement, so it is not counted against the transfer cap, and the only amount
    // refused outright is `type(uint256).max`. Everything below that is granted in full. A spender
    // is only reachable here by an admin allowlisting it per token, but the bound is the allowlist
    // and not a number. Recorded in SECURITY.md; if this ever changes, this assertion is the tripwire.
    expect(await guard.walletTokenSpentToday(tokenAddress, wallet.address)).to.equal(0n);
    await expect(
      guard.validateTokenApproval(wallet.address, tokenAddress, payee.address, max - 1n, "0x095ea7b3")
    ).to.not.be.reverted;
    expect(await guard.walletTokenSpentToday(tokenAddress, wallet.address)).to.equal(0n);
  });

  it("keeps the native and token lanes from leaking into each other", async function () {
    const { wallet, payee, policy, guard, token } = await deployStack();
    const tokenAddress = await token.getAddress();

    // Allowlisted and capped for tokens only, with nothing declared for the native lane.
    await policy.setTokenRegistered(tokenAddress, true);
    await policy.setTokenCounterparty(tokenAddress, payee.address, true);
    await policy.setTokenDailyLimit(tokenAddress, wallet.address, 5_000_000n);

    // The native lane does not inherit the token lane's allowlist or its cap.
    await expect(
      guard.validateAndRecord(wallet.address, payee.address, 1n, "0x12345678")
    ).to.be.revertedWithCustomError(guard, "CounterpartyNotAllowlisted");
    expect(await guard.walletSpentTodayWei(wallet.address)).to.equal(0n);

    // And an unregistered token is refused even when the recipient is allowlisted for another.
    const secondTokenFactory = await ethers.getContractFactory("MockUSDG");
    const secondToken = await secondTokenFactory.deploy();
    await secondToken.waitForDeployment();
    await expect(
      guard.validateTokenTransfer(wallet.address, await secondToken.getAddress(), payee.address, 1n, "0xa9059cbb")
    ).to.be.revertedWithCustomError(guard, "TokenNotRegistered");

    // Spending one lane must not consume the other's day.
    await guard.validateTokenTransfer(wallet.address, tokenAddress, payee.address, 4_000_000n, "0xa9059cbb");
    expect(await guard.walletTokenSpentToday(tokenAddress, wallet.address)).to.equal(4_000_000n);
    expect(await guard.walletSpentTodayWei(wallet.address)).to.equal(0n);

    await policy.setCounterparty(payee.address, true);
    await policy.setWalletDailyLimit(wallet.address, ethers.parseEther("5"));
    await guard.validateAndRecord(wallet.address, payee.address, 1000n, "0x12345678");
    expect(await guard.walletTokenSpentToday(tokenAddress, wallet.address)).to.equal(4_000_000n);
    expect(await guard.walletSpentTodayWei(wallet.address)).to.equal(1000n);
  });
});
