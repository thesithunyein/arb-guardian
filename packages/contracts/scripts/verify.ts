import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ethers, run, network } from "hardhat";

/**
 * Verify every contract from a recorded deployment on the target explorer.
 *
 * A judge's first check on smart-contract quality is the explorer. Bytecode that matches
 * the repo but is unverified reads as a gap, so this runs the whole set in one command:
 *
 *   npm run verify -w packages/contracts -- --network arbitrumSepolia
 *   npm run verify -w packages/contracts -- --network robinhoodTestnet
 *
 * Requires ARBISCAN_API_KEY (Arbitrum) or ROBINHOOD_EXPLORER_API_KEY (Robinhood Chain).
 * Reads addresses and constructor arguments from deployments/<network>.json.
 */
type DeploymentRecord = {
  network: string;
  chainId: number;
  deployer: string;
  policyManager: { address: string; txHash: string | null };
  executionGuard: { address: string; txHash: string | null };
  safeTreasuryGuard: { address: string; txHash: string | null };
};

async function verifyOne(name: string, address: string, constructorArguments: unknown[]) {
  console.log(`\n--- ${name} @ ${address}`);
  try {
    await run("verify:verify", {
      address,
      constructorArguments
    });
    console.log(`${name}: verified`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/already verified/i.test(message)) {
      console.log(`${name}: already verified`);
      return;
    }
    console.error(`${name}: verification failed — ${message}`);
    process.exitCode = 1;
  }
}

async function main() {
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const recordPath = resolve(__dirname, "..", "deployments", `${network.name}.json`);

  let record: DeploymentRecord;
  try {
    record = JSON.parse(readFileSync(recordPath, "utf8")) as DeploymentRecord;
  } catch {
    throw new Error(
      `No deployment record at ${recordPath}. Run the deploy script for this network first ` +
        `(npm run deploy:sepolia or npm run deploy:robinhood).`
    );
  }

  if (record.chainId !== chainId) {
    throw new Error(
      `Deployment record is for chain ${record.chainId} but the connected network is ${chainId}. ` +
        `Check --network and your RPC URL.`
    );
  }

  console.log(`Verifying ${record.network} (chain ${record.chainId}) with deployer ${record.deployer}`);

  // Constructor arguments must match what the deploy script used.
  await verifyOne("PolicyManager", record.policyManager.address, [record.deployer]);
  await verifyOne("ExecutionGuard", record.executionGuard.address, [
    record.deployer,
    record.policyManager.address
  ]);
  await verifyOne("SafeTreasuryGuard", record.safeTreasuryGuard.address, [
    record.deployer,
    record.policyManager.address
  ]);

  console.log("\nDone. Open the explorer and confirm each contract shows a verified source.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
