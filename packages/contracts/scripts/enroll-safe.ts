import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { ethers, network } from "hardhat";

const PAYROLL = "0x4444444444444444444444444444444444444444";
const UNLISTED = "0x5555555555555555555555555555555555555555";

/**
 * The settlement token for a live network, taken from the committed manifest so there is one place
 * that says which address is USDG. `npm run check:settlement` reads the same field and verifies the
 * address against the chain.
 */
function settlementTokenFor(networkName: string): { address: string; symbol: string; decimals: number } {
  const manifestPath = resolve(__dirname, "..", "evidence", "live-deployments.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    networks?: Array<{ name?: string; settlementToken?: { address?: string; symbol?: string; decimals?: number } }>;
  };
  const entry = manifest.networks?.find((n) => n.name === networkName)?.settlementToken;
  if (!entry?.address) {
    throw new Error(`No settlementToken declared for ${networkName} in evidence/live-deployments.json.`);
  }
  return { address: entry.address, symbol: entry.symbol ?? "USDG", decimals: entry.decimals ?? 6 };
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const deploymentsDir = resolve(__dirname, "..", "deployments");
  const deploymentPath = resolve(deploymentsDir, `${network.name}.json`);
  if (!existsSync(deploymentPath)) {
    throw new Error(`Missing ${deploymentPath}. Deploy contracts first.`);
  }

  const deployment = JSON.parse(readFileSync(deploymentPath, "utf8"));
  const policyAddress = deployment.policyManager.address as string;
  const safeGuardAddress = deployment.safeTreasuryGuard.address as string;

  console.log(`Enrolling treasury Safe shell on ${network.name}`);
  console.log(`Deployer: ${deployer.address}`);

  const shellFactory = await ethers.getContractFactory("TreasurySafeShell");
  const shell = await shellFactory.deploy(deployer.address);
  await shell.waitForDeployment();
  const shellReceipt = await shell.deploymentTransaction()?.wait();
  const shellAddress = await shell.getAddress();
  console.log(`TreasurySafeShell deployed: ${shellAddress}`);

  const setGuardTx = await shell.setGuard(safeGuardAddress);
  const setGuardReceipt = await setGuardTx.wait();
  console.log(`setGuard tx: ${setGuardReceipt?.hash}`);

  const safeGuard = await ethers.getContractAt("SafeTreasuryGuard", safeGuardAddress);
  const enrollTx = await safeGuard.setSafeEnrollment(shellAddress, true);
  const enrollReceipt = await enrollTx.wait();
  console.log(`setSafeEnrollment tx: ${enrollReceipt?.hash}`);

  const policy = await ethers.getContractAt("PolicyManager", policyAddress);
  await (await policy.setCounterparty(PAYROLL, true)).wait();
  await (await policy.setWalletDailyLimit(shellAddress, ethers.parseEther("5"))).wait();
  console.log(`Seeded allowlist + daily limit for Safe shell`);

  // ------------------------------------------------------------------ USDG token lane (live)
  // Skipped on the in-process chain, where the real token has no code. On a live network the lane is
  // pointed at the issuer's contract, and its decimals are read from that contract rather than
  // assumed: a cap configured at the wrong scale is off by a power of ten and nothing in this
  // repository would look wrong.
  if (network.name === "hardhat" || network.name === "localhost") {
    console.log("Skipping the USDG token lane: no issuer contract on the in-process chain.");
  } else {
    const usdg = settlementTokenFor(network.name);
    const token = new ethers.Contract(
      usdg.address,
      ["function symbol() view returns (string)", "function decimals() view returns (uint8)"],
      deployer
    );
    const [symbol, decimals] = await Promise.all([
      token.symbol() as Promise<string>,
      token.decimals() as Promise<bigint>
    ]);
    if (symbol !== usdg.symbol) {
      throw new Error(`Expected ${usdg.symbol} at ${usdg.address} on ${network.name} but the token calls itself ${symbol}.`);
    }
    if (Number(decimals) !== usdg.decimals) {
      throw new Error(
        `USDG reports ${decimals} decimals on ${network.name}, but the manifest declares ${usdg.decimals}. ` +
          "Fix the manifest before any cap is written, or every limit is wrong by a power of ten."
      );
    }

    const tokenCap = 5000n * 10n ** BigInt(usdg.decimals);
    await (await policy.setTokenRegistered(usdg.address, true)).wait();
    await (await policy.setTokenCounterparty(usdg.address, PAYROLL, true)).wait();
    await (await policy.setTokenDailyLimit(usdg.address, shellAddress, tokenCap)).wait();
    console.log(
      `USDG lane live: ${symbol} (${usdg.decimals} decimals) at ${usdg.address}, ` +
        `payroll allowlisted, cap ${tokenCap.toString()} base units per day`
    );
  }

  // Fund shell so value transfers can succeed in demos.
  // Keep this small so a single Robinhood faucet claim (0.01 ETH) still covers deploy+seed+enroll.
  const fundAmount =
    network.name === "robinhoodTestnet" ? ethers.parseEther("0.0005") : ethers.parseEther("0.002");
  const demoTransfer =
    network.name === "robinhoodTestnet" ? ethers.parseEther("0.0001") : ethers.parseEther("0.0005");
  const fundTx = await deployer.sendTransaction({
    to: shellAddress,
    value: fundAmount
  });
  await fundTx.wait();

  const okTx = await shell.execTransaction(PAYROLL, demoTransfer, "0x", 0);
  const okReceipt = await okTx.wait();
  console.log(`Demo allowed Safe exec tx: ${okReceipt?.hash}`);

  let blockedOk = false;
  try {
    await (await shell.execTransaction(UNLISTED, ethers.parseEther("0.0001"), "0x", 0)).wait();
  } catch {
    blockedOk = true;
    console.log("Demo blocked Safe exec reverted as expected (unlisted counterparty).");
  }

  const evidence = {
    ...deployment,
    treasurySafeShell: {
      address: shellAddress,
      deployTxHash: shellReceipt?.hash ?? null,
      setGuardTxHash: setGuardReceipt?.hash ?? null,
      enrollmentTxHash: enrollReceipt?.hash ?? null,
      fundTxHash: fundTx.hash,
      allowedExecTxHash: okReceipt?.hash ?? null,
      blockedExecProven: blockedOk,
      guard: safeGuardAddress,
      owner: deployer.address
    }
  };

  mkdirSync(deploymentsDir, { recursive: true });
  writeFileSync(deploymentPath, JSON.stringify(evidence, null, 2), "utf8");
  writeFileSync(resolve(deploymentsDir, "latest.json"), JSON.stringify(evidence, null, 2), "utf8");

  console.log("\nCopy into root .env / Vercel:");
  console.log(`SUBMISSION_TREASURY_SAFE_ADDRESS=${shellAddress}`);
  console.log(`SUBMISSION_TREASURY_SAFE_TX=${shellReceipt?.hash ?? ""}`);
  console.log(`SUBMISSION_SAFE_ENROLLMENT_TX=${enrollReceipt?.hash ?? ""}`);
  console.log(`SUBMISSION_SAFE_SET_GUARD_TX=${setGuardReceipt?.hash ?? ""}`);
  console.log(`SUBMISSION_SAFE_ALLOWED_EXEC_TX=${okReceipt?.hash ?? ""}`);
  console.log(`VITE_TREASURY_SAFE_ADDRESS=${shellAddress}`);
  console.log(`VITE_TREASURY_SAFE_TX=${shellReceipt?.hash ?? ""}`);
  console.log(`VITE_SAFE_ENROLLMENT_TX=${enrollReceipt?.hash ?? ""}`);
  console.log(`VITE_SAFE_SET_GUARD_TX=${setGuardReceipt?.hash ?? ""}`);
  console.log(`VITE_SAFE_ALLOWED_EXEC_TX=${okReceipt?.hash ?? ""}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
