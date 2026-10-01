import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ethers, network } from "hardhat";

/**
 * Deploy the Arb Guardian policy stack to an Arbitrum-family chain.
 *
 * Optionally registers a token lane for a stablecoin — on Robinhood Chain that means USDG,
 * the chain's natively issued Global Dollar — via env:
 *
 *   USDG_ADDRESS             token contract to register
 *   USDG_TREASURY_ADDRESS    optional: treasury wallet/Safe to cap
 *   USDG_DAILY_LIMIT_UNITS   optional: daily cap in the token's base units (USDG = 6 dp)
 *   USDG_RECIPIENT           optional: counterparty to allowlist for that token
 *
 * Nothing here is fee-bearing beyond testnet gas, and no policy is applied silently: every
 * value comes from the environment and is printed before it is written.
 */
async function main() {
  const signers = await ethers.getSigners();
  if (signers.length === 0) {
    throw new Error(
      "No deployer account configured. Set DEPLOYER_PRIVATE_KEY in .env and ensure the wallet has Arbitrum Sepolia ETH."
    );
  }
  const [deployer] = await ethers.getSigners();
  console.log(`Deploying with ${deployer.address} on ${network.name}`);

  const policyFactory = await ethers.getContractFactory("PolicyManager");
  const policy = await policyFactory.deploy(deployer.address);
  await policy.waitForDeployment();
  const policyReceipt = await policy.deploymentTransaction()?.wait();
  const policyAddress = await policy.getAddress();
  console.log(`PolicyManager deployed: ${policyAddress}`);

  const guardFactory = await ethers.getContractFactory("ExecutionGuard");
  const guard = await guardFactory.deploy(deployer.address, policyAddress);
  await guard.waitForDeployment();
  const guardReceipt = await guard.deploymentTransaction()?.wait();
  const guardAddress = await guard.getAddress();
  console.log(`ExecutionGuard deployed: ${guardAddress}`);

  const safeGuardFactory = await ethers.getContractFactory("SafeTreasuryGuard");
  const safeGuard = await safeGuardFactory.deploy(deployer.address, policyAddress);
  await safeGuard.waitForDeployment();
  const safeGuardReceipt = await safeGuard.deploymentTransaction()?.wait();
  const safeGuardAddress = await safeGuard.getAddress();
  console.log(`SafeTreasuryGuard deployed: ${safeGuardAddress}`);

  // ------------------------------------------------------------- token lane (USDG)

  const usdgAddress = process.env.USDG_ADDRESS?.trim();
  const usdgTreasury = process.env.USDG_TREASURY_ADDRESS?.trim();
  const usdgLimit = process.env.USDG_DAILY_LIMIT_UNITS?.trim();
  const usdgRecipient = process.env.USDG_RECIPIENT?.trim();
  const tokenSetupTxs: Record<string, string | null> = {};

  if (usdgAddress) {
    console.log(`\nToken lane: registering ${usdgAddress}`);
    tokenSetupTxs.registered = (await (await policy.setTokenRegistered(usdgAddress, true)).wait())?.hash ?? null;

    if (usdgRecipient) {
      console.log(`  allowlist counterparty: ${usdgRecipient}`);
      tokenSetupTxs.counterparty =
        (await (await policy.setTokenCounterparty(usdgAddress, usdgRecipient, true)).wait())?.hash ?? null;
    }
    if (usdgTreasury && usdgLimit) {
      console.log(`  daily cap: ${usdgLimit} base units for ${usdgTreasury}`);
      tokenSetupTxs.dailyLimit =
        (await (await policy.setTokenDailyLimit(usdgAddress, usdgTreasury, BigInt(usdgLimit))).wait())?.hash ?? null;
    }
    if (!usdgTreasury || !usdgLimit) {
      console.log(
        "  note: no cap set yet, so the token lane is deny-by-default for every wallet. " +
          "Set USDG_TREASURY_ADDRESS and USDG_DAILY_LIMIT_UNITS to open a bounded lane."
      );
    }
  } else {
    console.log("\nToken lane: USDG_ADDRESS not set, skipping (native lane only).");
  }

  // ------------------------------------------------------------------------ evidence

  const evidence = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    policyManager: { address: policyAddress, txHash: policyReceipt?.hash ?? null },
    executionGuard: { address: guardAddress, txHash: guardReceipt?.hash ?? null },
    safeTreasuryGuard: { address: safeGuardAddress, txHash: safeGuardReceipt?.hash ?? null },
    tokenLane: usdgAddress
      ? {
          token: usdgAddress,
          registeredTx: tokenSetupTxs.registered,
          treasury: usdgTreasury ?? null,
          dailyLimitUnits: usdgLimit ?? null,
          counterpartyTx: tokenSetupTxs.counterparty ?? null,
          dailyLimitTx: tokenSetupTxs.dailyLimit ?? null
        }
      : null
  };

  const outDir = resolve(__dirname, "..", "deployments");
  mkdirSync(outDir, { recursive: true });
  const outFile = resolve(outDir, `${network.name}.json`);
  writeFileSync(outFile, JSON.stringify(evidence, null, 2), "utf8");
  writeFileSync(resolve(outDir, "latest.json"), JSON.stringify(evidence, null, 2), "utf8");

  console.log(`\nWrote local deployment evidence: ${outFile}`);
  console.log("Copy into root .env for submission finalize:");
  console.log(`SUBMISSION_POLICY_MANAGER_ADDRESS=${policyAddress}`);
  console.log(`SUBMISSION_EXECUTION_GUARD_ADDRESS=${guardAddress}`);
  console.log(`SUBMISSION_SAFE_TREASURY_GUARD_ADDRESS=${safeGuardAddress}`);
  if (policyReceipt?.hash) console.log(`SUBMISSION_POLICY_MANAGER_TX=${policyReceipt.hash}`);
  if (guardReceipt?.hash) console.log(`SUBMISSION_EXECUTION_GUARD_TX=${guardReceipt.hash}`);
  if (safeGuardReceipt?.hash) console.log(`SUBMISSION_SAFE_TREASURY_GUARD_TX=${safeGuardReceipt.hash}`);

  console.log("\nVerify source on the explorer:");
  console.log(`  npm run verify -w packages/contracts -- --network ${network.name}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
