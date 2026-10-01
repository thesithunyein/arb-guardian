import { expect } from "chai";
import { ethers } from "hardhat";

/**
 * Policy attestation: every policy mutation advances a hash-chained
 * `policyVersion` / `policyDigest`, and every guard decision record is stamped with the
 * version and digest that were in force when the decision was made.
 *
 * These tests deliberately verify the chain by *replaying it from logs* rather than by
 * trusting the contract's own state, which is the property the evidence pack also checks.
 */
describe("Policy attestation (versioned, replayable policy digest)", function () {
  const abi = ethers.AbiCoder.defaultAbiCoder();
  const kind = (name: string) => ethers.keccak256(ethers.toUtf8Bytes(name));

  const GENESIS_SEED_LABEL = "arb-guardian.policy.genesis";

  function digestOf(previous: string, version: bigint, amendmentKind: string, params: string) {
    return ethers.keccak256(
      abi.encode(["bytes32", "uint256", "bytes32", "bytes"], [previous, version, amendmentKind, params])
    );
  }

  async function deployPolicy(adminAddress?: string) {
    const [admin, wallet, destination] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("PolicyManager");
    const policy = await factory.deploy(adminAddress ?? admin.address);
    await policy.waitForDeployment();

    const chainId = (await ethers.provider.getNetwork()).chainId;
    const seed = ethers.keccak256(
      ethers.solidityPacked(["string", "uint256"], [GENESIS_SEED_LABEL, chainId])
    );

    return { admin, wallet, destination, policy, seed, chainId };
  }

  /**
   * Rebuild the digest chain from `PolicyAmended` logs only, starting from the seed.
   * Returns one step per version so tests can assert the whole history replays.
   */
  async function replayAmendments(policy: any, seed: string) {
    const filter = policy.filters.PolicyAmended();
    const logs = await policy.queryFilter(filter, 0, "latest");
    const steps: Array<{ version: bigint; digest: string; kind: string; params: string }> = [];

    let previous = seed;
    for (const log of logs) {
      const { version, digest, kind: amendmentKind, params } = (log as any).args;
      expect(version, "versions must be contiguous and start at 0").to.equal(BigInt(steps.length));
      expect(
        digestOf(previous, version, amendmentKind, params),
        `digest mismatch replaying version ${version}`
      ).to.equal(digest);
      steps.push({ version, digest, kind: amendmentKind, params });
      previous = digest;
    }
    return steps;
  }

  it("starts at version 0 with a genesis digest derived from the chain id", async function () {
    const { admin, policy, seed, chainId } = await deployPolicy();

    expect(await policy.policyVersion()).to.equal(0n);
    expect(await policy.genesisSeed()).to.equal(seed);

    const expectedGenesis = digestOf(
      seed,
      0n,
      kind("genesis"),
      abi.encode(["address"], [admin.address])
    );
    expect(await policy.policyDigest()).to.equal(expectedGenesis);

    // The seed is chain-bound, so the same policy history elsewhere cannot share a digest.
    const foreignSeed = ethers.keccak256(
      ethers.solidityPacked(["string", "uint256"], [GENESIS_SEED_LABEL, chainId + 1n])
    );
    expect(foreignSeed).to.not.equal(seed);
    expect(await policy.policyDigest()).to.not.equal(
      digestOf(foreignSeed, 0n, kind("genesis"), abi.encode(["address"], [admin.address]))
    );
  });

  it("advances the version by one for every policy mutation and replays from logs", async function () {
    const { admin, wallet, destination, policy, seed } = await deployPolicy();

    await policy.setCounterparty(destination.address, true);
    await policy.setWalletDailyLimit(wallet.address, ethers.parseEther("10"));
    await policy.setTokenRegistered(destination.address, true);
    await policy.pause();

    expect(await policy.policyVersion()).to.equal(4n);

    const steps = await replayAmendments(policy, seed);
    expect(steps).to.have.length(5);
    expect(steps[0].kind).to.equal(kind("genesis"));
    expect(steps[1].kind).to.equal(kind("setCounterparty"));
    expect(steps[2].kind).to.equal(kind("setWalletDailyLimit"));
    expect(steps[3].kind).to.equal(kind("setTokenRegistered"));
    expect(steps[4].kind).to.equal(kind("pause"));

    // The digest chain is what the contract reports as current.
    expect(await policy.policyDigest()).to.equal(steps[steps.length - 1].digest);
  });

  it("is tamper-evident: editing one amendment changes every later digest", async function () {
    const { admin, wallet, destination, policy, seed } = await deployPolicy();

    await policy.setCounterparty(destination.address, true);
    await policy.setWalletDailyLimit(wallet.address, ethers.parseEther("10"));

    const steps = await replayAmendments(policy, seed);
    const [genesisStep, counterpartyStep, limitStep] = steps;

    // Re-encode amendment 1 with a different counterparty flag. Every digest downstream must move.
    const tampered = digestOf(
      genesisStep.digest,
      counterpartyStep.version,
      counterpartyStep.kind,
      abi.encode(["address", "bool"], [destination.address, false])
    );
    expect(tampered).to.not.equal(counterpartyStep.digest);

    const tamperedTail = digestOf(
      tampered,
      limitStep.version,
      limitStep.kind,
      limitStep.params
    );
    expect(tamperedTail).to.not.equal(limitStep.digest);
    expect(await policy.policyDigest()).to.equal(limitStep.digest);
  });

  it("depends on the genesis admin, so two policies never share a digest", async function () {
    const { policy: first } = await deployPolicy();
    const signers = await ethers.getSigners();
    const { policy: second } = await deployPolicy(signers[5].address);

    expect(await first.policyDigest()).to.not.equal(await second.policyDigest());
  });

  it("stamps every allowed native decision with the policy version in force", async function () {
    const { admin, destination, wallet, policy, seed } = await deployPolicy();

    const guardFactory = await ethers.getContractFactory("ExecutionGuard");
    const guard = await guardFactory.deploy(admin.address, await policy.getAddress());
    await guard.waitForDeployment();

    await policy.setCounterparty(destination.address, true);
    await policy.setWalletDailyLimit(wallet.address, ethers.parseEther("10"));

    const first = await (
      await guard.validateAndRecord(wallet.address, destination.address, ethers.parseEther("1"), "0x12345678")
    ).wait();
    const firstRecord = first!.logs
      .map((log: any) => {
        try {
          return guard.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((parsed: any) => parsed?.name === "TransactionValidated");

    expect(firstRecord!.args.policyVersion).to.equal(2n);
    expect(firstRecord!.args.policyDigest).to.equal(await policy.policyDigest());

    // Amend policy (raise the cap), then spend again: the stamp must follow the new version.
    await policy.setWalletDailyLimit(wallet.address, ethers.parseEther("20"));

    const second = await (
      await guard.validateAndRecord(wallet.address, destination.address, ethers.parseEther("1"), "0x12345678")
    ).wait();
    const secondRecord = second!.logs
      .map((log: any) => {
        try {
          return guard.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((parsed: any) => parsed?.name === "TransactionValidated");

    expect(secondRecord!.args.policyVersion).to.equal(3n);
    expect(secondRecord!.args.policyVersion).to.not.equal(firstRecord!.args.policyVersion);
    expect(secondRecord!.args.policyDigest).to.equal(await policy.policyDigest());

    // And the stamped versions must exist in the replayable amendment history.
    const steps = await replayAmendments(policy, seed);
    const versions = steps.map((step) => step.version);
    expect(versions).to.include(firstRecord!.args.policyVersion);
    expect(versions).to.include(secondRecord!.args.policyVersion);
    expect(steps[Number(secondRecord!.args.policyVersion)].digest).to.equal(
      secondRecord!.args.policyDigest
    );
  });

  it("stamps token-lane decisions, including cap changes", async function () {
    const { admin, wallet, destination, policy, seed } = await deployPolicy();

    const tokenFactory = await ethers.getContractFactory("MockUSDG");
    const token = await tokenFactory.deploy();
    await token.waitForDeployment();
    const tokenAddress = await token.getAddress();

    const guardFactory = await ethers.getContractFactory("ExecutionGuard");
    const guard = await guardFactory.deploy(admin.address, await policy.getAddress());
    await guard.waitForDeployment();

    const usdg = (whole: number) => BigInt(whole) * 10n ** 6n;
    await policy.setTokenRegistered(tokenAddress, true);
    await policy.setTokenCounterparty(tokenAddress, destination.address, true);
    await policy.setTokenDailyLimit(tokenAddress, wallet.address, usdg(5000));

    const tx = await guard.validateTokenTransfer(
      wallet.address,
      tokenAddress,
      destination.address,
      usdg(1000),
      "0xa9059cbb"
    );
    const receipt = await tx.wait();
    const record = receipt!.logs
      .map((log: any) => {
        try {
          return guard.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((parsed: any) => parsed?.name === "TokenTransferValidated");

    expect(record!.args.policyVersion).to.equal(await policy.policyVersion());
    expect(record!.args.policyDigest).to.equal(await policy.policyDigest());

    const steps = await replayAmendments(policy, seed);
    expect(steps[Number(record!.args.policyVersion)].digest).to.equal(record!.args.policyDigest);
  });

  it("stamps Safe-guard transaction checks with the digest that judged them", async function () {
    const { admin, destination, policy, seed } = await deployPolicy();
    const [, , , , , candidateSafe] = await ethers.getSigners();

    const guardFactory = await ethers.getContractFactory("SafeTreasuryGuard");
    const guard = await guardFactory.deploy(admin.address, await policy.getAddress());
    await guard.waitForDeployment();

    await guard.setSafeEnrollment(candidateSafe.address, true);
    await policy.setCounterparty(destination.address, true);

    const tx = await guard
      .connect(candidateSafe)
      .checkTransaction(
        destination.address,
        0,
        "0x",
        0,
        0,
        0,
        0,
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        "0x",
        ethers.ZeroAddress
      );
    const receipt = await tx.wait();
    const record = receipt!.logs
      .map((log: any) => {
        try {
          return guard.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((parsed: any) => parsed?.name === "SafeTxChecked");

    expect(record!.args.reason).to.equal("allowed");
    expect(record!.args.policyVersion).to.equal(await policy.policyVersion());
    expect(record!.args.policyDigest).to.equal(await policy.policyDigest());

    const steps = await replayAmendments(policy, seed);
    expect(steps[Number(record!.args.policyVersion)].digest).to.equal(record!.args.policyDigest);
  });

  it("reports the live snapshot the guards read", async function () {
    const { wallet, policy } = await deployPolicy();

    const before = await policy.policySnapshot();
    await policy.setWalletDailyLimit(wallet.address, ethers.parseEther("1"));
    const after = await policy.policySnapshot();

    expect(before[0]).to.equal(0n);
    expect(after[0]).to.equal(1n);
    expect(after[1]).to.not.equal(before[1]);
    expect(after[0]).to.equal(await policy.policyVersion());
    expect(after[1]).to.equal(await policy.policyDigest());
  });
});
