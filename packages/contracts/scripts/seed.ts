import { ethers, network } from "hardhat";

const DEMO = {
  treasuryA: "0x1111111111111111111111111111111111111111",
  treasuryB: "0x2222222222222222222222222222222222222222",
  treasuryC: "0x3333333333333333333333333333333333333333",
  payrollVault: "0x4444444444444444444444444444444444444444",
  unlistedVendor: "0x5555555555555555555555555555555555555555"
};

async function main() {
  const deploymentFile = network.name === "hardhat" ? "hardhat" : network.name;
  const fs = await import("node:fs");
  const path = await import("node:path");
  const deploymentsDir = path.resolve(__dirname, "..", "deployments");
  const deploymentPath = path.resolve(deploymentsDir, `${deploymentFile}.json`);

  if (!fs.existsSync(deploymentPath)) {
    throw new Error(`Missing deployment file: ${deploymentPath}. Run deploy first.`);
  }

  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  const policyAddress = deployment.policyManager.address;
  const policy = await ethers.getContractAt("PolicyManager", policyAddress);

  console.log(`Seeding PolicyManager at ${policyAddress} on ${network.name}`);

  await policy.setCounterparty(DEMO.payrollVault, true);
  await policy.setCounterparty(DEMO.unlistedVendor, false);
  await policy.setWalletDailyLimit(DEMO.treasuryA, ethers.parseEther("0.5"));
  await policy.setWalletDailyLimit(DEMO.treasuryB, ethers.parseEther("3"));
  await policy.setWalletDailyLimit(DEMO.treasuryC, ethers.parseEther("5"));

  const seeded = {
    seededAt: new Date().toISOString(),
    network: network.name,
    policyManager: policyAddress,
    demoAddresses: DEMO,
    policies: {
      allowlisted: [DEMO.payrollVault],
      walletLimitsWei: {
        [DEMO.treasuryA]: ethers.parseEther("0.5").toString(),
        [DEMO.treasuryB]: ethers.parseEther("3").toString(),
        [DEMO.treasuryC]: ethers.parseEther("5").toString()
      }
    }
  };

  fs.writeFileSync(path.resolve(deploymentsDir, `${deploymentFile}-seed.json`), JSON.stringify(seeded, null, 2));
  console.log("Demo policy seed complete.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
