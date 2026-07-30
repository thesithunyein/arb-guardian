import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ethers, network } from "hardhat";

async function main() {
  const signers = await ethers.getSigners();
  if (signers.length === 0) {
    throw new Error(
      "No deployer account configured. Set DEPLOYER_PRIVATE_KEY in .env and ensure the wallet has Arbitrum Sepolia ETH."
    );
  }
  const [deployer] = signers;
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

  const evidence = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    policyManager: {
      address: policyAddress,
      txHash: policyReceipt?.hash ?? null
    },
    executionGuard: {
      address: guardAddress,
      txHash: guardReceipt?.hash ?? null
    },
    safeTreasuryGuard: {
      address: safeGuardAddress,
      txHash: safeGuardReceipt?.hash ?? null
    }
  };

  const outDir = resolve(__dirname, "..", "deployments");
  mkdirSync(outDir, { recursive: true });
  const outFile = resolve(outDir, `${network.name}.json`);
  writeFileSync(outFile, JSON.stringify(evidence, null, 2), "utf8");
  writeFileSync(resolve(outDir, "latest.json"), JSON.stringify(evidence, null, 2), "utf8");

  console.log(`Wrote local deployment evidence: ${outFile}`);
  console.log("Copy into root .env for submission finalize:");
  console.log(`SUBMISSION_POLICY_MANAGER_ADDRESS=${policyAddress}`);
  console.log(`SUBMISSION_EXECUTION_GUARD_ADDRESS=${guardAddress}`);
  console.log(`SUBMISSION_SAFE_TREASURY_GUARD_ADDRESS=${safeGuardAddress}`);
  if (policyReceipt?.hash) console.log(`SUBMISSION_POLICY_MANAGER_TX=${policyReceipt.hash}`);
  if (guardReceipt?.hash) console.log(`SUBMISSION_EXECUTION_GUARD_TX=${guardReceipt.hash}`);
  if (safeGuardReceipt?.hash) console.log(`SUBMISSION_SAFE_TREASURY_GUARD_TX=${safeGuardReceipt.hash}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
