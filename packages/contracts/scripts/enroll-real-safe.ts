import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ethers, network } from "hardhat";

/**
 * Enrol a REAL Gnosis Safe as the guarded treasury, on a live network.
 *
 * Why this exists: the marquee claim is that the guard sees every transaction inside the Safe's
 * own `execTransaction`. The testnet enrolment written by `enroll-safe.ts` uses
 * `TreasurySafeShell` — a bespoke 1-of-1 contract that exposes the GuardManager surface. That
 * proves the guard works; it does not prove the Safe integration, because a shell lets its owner
 * call `setGuard` directly, whereas Safe 1.4.1 `GuardManager.setGuard` is `SelfAuthorized` and can
 * only arrive as an owner-approved `execTransaction` that calls the Safe itself.
 *
 * This script closes that gap using the canonical Safe v1.4.1 deployment (verified present on both
 * lanes by reading their bytecode): it creates a real Safe through the real proxy factory, installs
 * the guard through the real self-call, enrols it, seeds the policy, and records an allowed and a
 * blocked transaction.
 *
 * It is dry by default. Sending transactions requires an explicit confirmation:
 *
 *   REAL_SAFE_CONFIRM=1 npm run enroll:real-safe -w packages/contracts -- --network arbitrumSepolia
 *   REAL_SAFE_CONFIRM=1 npm run enroll:real-safe -w packages/contracts -- --network robinhoodTestnet
 *
 * Exit codes: 0 the plan was validated (dry) or the Safe was enrolled and the guard refused the
 * unsafe spend; 1 a prerequisite failed, or the unsafe spend was NOT refused.
 */

const CANONICAL_SAFE = {
  proxyFactory: "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
  singleton: "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762",
  fallbackHandler: "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99"
} as const;

const PAYROLL = "0x4444444444444444444444444444444444444444";
const UNLISTED = "0x5555555555555555555555555555555555555555";
const NATIVE_DAILY_LIMIT = ethers.parseEther("5");

const SAFE_ABI = [
  "function setup(address[] _owners, uint256 _threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address paymentReceiver)",
  "function nonce() view returns (uint256)",
  "function getThreshold() view returns (uint256)",
  "function getOwners() view returns (address[])",
  "function getGuard() view returns (address)",
  "function VERSION() view returns (string)",
  "function approveHash(bytes32 hashToApprove)",
  "function getTransactionHash(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, uint256 _nonce) view returns (bytes32)",
  "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) returns (bool)"
];

const FACTORY_ABI = [
  "function createProxyWithNonce(address _singleton, bytes initializer, uint256 saltNonce) returns (address proxy)",
  "event ProxyCreation(address proxy, address singleton)"
];

const GUARD_ABI = [
  "function setSafeEnrollment(address safe, bool enrolled)",
  "function safeEnrolled(address safe) view returns (bool)"
];

const TOKEN_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)"
];

type Manifest = {
  networks?: Array<{
    name?: string;
    label?: string;
    settlementToken?: { address?: string; symbol?: string; decimals?: number };
  }>;
};

function settlementTokenFor(networkName: string): { address: string; symbol: string; decimals: number } {
  const manifestPath = resolve(__dirname, "..", "evidence", "live-deployments.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
  const entry = manifest.networks?.find((n) => n.name === networkName)?.settlementToken;
  if (!entry?.address) {
    throw new Error(`No settlementToken declared for ${networkName} in evidence/live-deployments.json.`);
  }
  return { address: entry.address, symbol: entry.symbol ?? "USDG", decimals: entry.decimals ?? 6 };
}

function canonicalSafe() {
  return {
    proxyFactory: process.env.SAFE_PROXY_FACTORY?.trim() || CANONICAL_SAFE.proxyFactory,
    singleton: process.env.SAFE_SINGLETON?.trim() || CANONICAL_SAFE.singleton,
    fallbackHandler: process.env.SAFE_FALLBACK_HANDLER?.trim() || CANONICAL_SAFE.fallbackHandler
  };
}

async function main() {
  const confirm = process.env.REAL_SAFE_CONFIRM === "1";

  if (network.name === "hardhat" || network.name === "localhost") {
    throw new Error(
      "This script is for a live network. The in-process proof already exists: npm run evidence -w packages/contracts"
    );
  }

  const deploymentPath = resolve(__dirname, "..", "deployments", `${network.name}.json`);
  if (!existsSync(deploymentPath)) {
    throw new Error(`Missing ${deploymentPath}. Deploy the policy stack first (npm run redeploy:sepolia).`);
  }
  const deployment = JSON.parse(readFileSync(deploymentPath, "utf8")) as {
    chainId?: number;
    policyManager?: { address?: string };
    safeTreasuryGuard?: { address?: string };
  };
  if (deployment.chainId === 31337) {
    throw new Error("That deployment record describes a throwaway local chain. Refusing to enrol against it.");
  }
  const policyAddress = deployment.policyManager?.address;
  const guardAddress = deployment.safeTreasuryGuard?.address;
  if (!policyAddress || !guardAddress) {
    throw new Error("The deployment record is missing policyManager or safeTreasuryGuard.");
  }

  const [deployer] = await ethers.getSigners();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const safe = canonicalSafe();

  console.log(`Network:        ${network.name} (chain id ${chainId})`);
  console.log(
    `Deployer:       ${deployer ? `${deployer.address} (becomes the sole Safe owner)` : "unknown — no DEPLOYER_PRIVATE_KEY set"}`
  );
  console.log(`PolicyManager:  ${policyAddress}`);
  console.log(`SafeGuard:      ${guardAddress}`);
  console.log(`Safe factory:   ${safe.proxyFactory}`);
  console.log(`Safe singleton: ${safe.singleton}`);
  console.log(`Handler:        ${safe.fallbackHandler}`);

  // Fail before spending gas: the canonical contracts must actually be there.
  for (const [label, address] of Object.entries(safe)) {
    const code = await ethers.provider.getCode(address);
    if (code === "0x") {
      throw new Error(
        `No contract at the ${label} address ${address} on ${network.name}. ` +
          "Override it with SAFE_PROXY_FACTORY / SAFE_SINGLETON / SAFE_FALLBACK_HANDLER."
      );
    }
  }

  // The dry run works without a key on purpose: the addresses are checked against the live chain,
  // which is the part most likely to be wrong, and no transaction is signed or sent.
  if (!confirm || !deployer) {
    console.log("\nDry run. Nothing was sent.");
    if (!deployer) {
      console.log("No DEPLOYER_PRIVATE_KEY is set, so the Safe owner is not known yet.");
    }
    console.log("Everything above was read from the live chain. This would: create a real Safe,");
    console.log("install the guard through an owner-approved execTransaction self-call, enrol it,");
    console.log("seed the policy, then record one allowed and one blocked transaction.");
    console.log("\nRe-run with REAL_SAFE_CONFIRM=1 (and a funded key) to send it.");
    if (!confirm) return;
    throw new Error("REAL_SAFE_CONFIRM=1 was set but no deployer signer is configured. Set DEPLOYER_PRIVATE_KEY.");
  }

  // ------------------------------------------------------------------ create a real Safe

  const factory = new ethers.Contract(safe.proxyFactory, FACTORY_ABI, deployer);
  const safeInterface = new ethers.Interface(SAFE_ABI);
  const setupData = safeInterface.encodeFunctionData("setup", [
    [deployer.address],
    1n,
    ethers.ZeroAddress,
    "0x",
    safe.fallbackHandler,
    ethers.ZeroAddress,
    0n,
    ethers.ZeroAddress
  ]);

  const saltNonce = BigInt(Date.now());
  const createTx = await factory.createProxyWithNonce(safe.singleton, setupData, saltNonce);
  const createReceipt = await createTx.wait();
  if (!createReceipt) throw new Error("The Safe creation transaction produced no receipt.");

  let safeAddress: string | null = null;
  for (const log of createReceipt.logs) {
    try {
      const parsed = factory.interface.parseLog({ topics: [...log.topics], data: log.data });
      if (parsed?.name === "ProxyCreation") {
        safeAddress = String(parsed.args[0]);
        break;
      }
    } catch {
      // Not one of ours; ignore.
    }
  }
  if (!safeAddress) throw new Error("Could not read the ProxyCreation event, so the Safe address is unknown.");

  const safeContract = new ethers.Contract(safeAddress, SAFE_ABI, deployer);
  const version: string = await safeContract.VERSION();
  const threshold = await safeContract.getThreshold();
  const owners = (await safeContract.getOwners()) as string[];
  console.log(`\nReal Gnosis Safe deployed: ${safeAddress}`);
  console.log(`  version ${version} · threshold ${threshold} · owners ${owners.join(", ")}`);
  console.log(`  creation tx: ${createReceipt.hash}`);

  /** Execute through the Safe itself, the only way Safe 1.4.1 permits a self-call. */
  async function execSafeTx(to: string, value: bigint, data: string) {
    const nonce = await safeContract.nonce();
    const txHash: string = await safeContract.getTransactionHash(
      to,
      value,
      data,
      0,
      0n,
      0n,
      0n,
      ethers.ZeroAddress,
      ethers.ZeroAddress,
      nonce
    );
    // Pre-approved hash signature: owner (32 bytes) || offset (32 zero bytes) || v = 1.
    await (await safeContract.approveHash(txHash)).wait();
    const signature = ethers.concat([ethers.zeroPadValue(deployer.address, 32), ethers.ZeroHash, "0x01"]);
    return safeContract.execTransaction(
      to,
      value,
      data,
      0,
      0n,
      0n,
      0n,
      ethers.ZeroAddress,
      ethers.ZeroAddress,
      signature
    );
  }

  // ------------------------------------------------------------------ enrol + seed policy

  const guard = new ethers.Contract(guardAddress, GUARD_ABI, deployer);
  const policy = await ethers.getContractAt("PolicyManager", policyAddress);

  const enrollTx = await guard.setSafeEnrollment(safeAddress, true);
  await enrollTx.wait();
  console.log(`Enrolled the Safe in the guard: ${enrollTx.hash}`);

  await (await policy.setCounterparty(PAYROLL, true)).wait();
  await (await policy.setWalletDailyLimit(safeAddress, NATIVE_DAILY_LIMIT)).wait();
  console.log(`Seeded allowlist + ${ethers.formatEther(NATIVE_DAILY_LIMIT)} ETH/day for the real Safe`);

  // The token lane reads its own decimals from the issuer contract. A cap written at the wrong
  // scale is off by a power of ten and nothing else in this repository would look wrong.
  const usdg = settlementTokenFor(network.name);
  const token = new ethers.Contract(usdg.address, TOKEN_ABI, deployer);
  const [symbol, decimals] = await Promise.all([
    token.symbol() as Promise<string>,
    token.decimals() as Promise<bigint>
  ]);
  if (symbol !== usdg.symbol || Number(decimals) !== usdg.decimals) {
    throw new Error(
      `Settlement token mismatch: ${usdg.address} on ${network.name} reports ${symbol}/${decimals}, ` +
        `the manifest declares ${usdg.symbol}/${usdg.decimals}. Fix the manifest before writing any cap.`
    );
  }
  const tokenCap = 5000n * 10n ** BigInt(usdg.decimals);
  await (await policy.setTokenRegistered(usdg.address, true)).wait();
  await (await policy.setTokenCounterparty(usdg.address, PAYROLL, true)).wait();
  await (await policy.setTokenDailyLimit(usdg.address, safeAddress, tokenCap)).wait();
  console.log(`USDG lane seeded: ${symbol} (${decimals} decimals) at ${usdg.address}, cap ${tokenCap} base units/day`);

  // ------------------------------------------------------------------ install the guard

  const installData = safeInterface.encodeFunctionData("setGuard", [guardAddress]);
  const installTx = await execSafeTx(safeAddress, 0n, installData);
  const installReceipt = await installTx.wait();
  if (installReceipt?.status !== 1) throw new Error("Installing the guard through the Safe self-call failed.");

  const installedGuard: string = await safeContract.getGuard();
  if (installedGuard.toLowerCase() !== guardAddress.toLowerCase()) {
    throw new Error(`The Safe reports guard ${installedGuard}, expected ${guardAddress}.`);
  }
  console.log(`Guard installed through the Safe's own execTransaction: ${installReceipt.hash}`);
  console.log(`  Safe.getGuard() = ${installedGuard}`);

  // ------------------------------------------------------------------ prove both directions

  await (await deployer.sendTransaction({ to: safeAddress, value: ethers.parseEther("0.01") })).wait();

  const allowedTx = await execSafeTx(PAYROLL, ethers.parseEther("0.001"), "0x");
  const allowedReceipt = await allowedTx.wait();
  console.log(`\nAllowed: payment to the allowlisted payee settled — ${allowedReceipt?.hash}`);

  let blocked = false;
  let blockedReason = "";
  try {
    const blockedTx = await execSafeTx(UNLISTED, ethers.parseEther("0.001"), "0x");
    const blockedReceipt = await blockedTx.wait();
    if (blockedReceipt?.status === 0) {
      blocked = true;
      blockedReason = "transaction reverted";
    }
  } catch (error) {
    blocked = true;
    blockedReason = error instanceof Error ? error.message.slice(0, 160) : String(error);
  }

  if (!blocked) {
    throw new Error(
      "The unsafe payment to a non-allowlisted address was NOT refused by the installed guard. " +
        "That is a failure of the enforcement claim, not a flaky test."
    );
  }
  console.log(`Blocked: payment to ${UNLISTED} was refused inside the Safe — ${blockedReason}`);

  // ------------------------------------------------------------------ record the evidence

  const evidence = {
    ...deployment,
    realSafe: {
      address: safeAddress,
      version,
      threshold: Number(threshold),
      owners,
      guard: installedGuard,
      proxyFactory: safe.proxyFactory,
      singleton: safe.singleton,
      fallbackHandler: safe.fallbackHandler,
      createTxHash: createReceipt.hash,
      enrollTxHash: enrollTx.hash,
      setGuardThroughExecTransactionTxHash: installReceipt.hash,
      allowedExecTxHash: allowedReceipt?.hash ?? null,
      blockedExecRefused: blocked
    }
  };
  writeFileSync(deploymentPath, JSON.stringify(evidence, null, 2), "utf8");
  console.log(`\nWrote the real-Safe evidence into ${deploymentPath}`);

  const explorer = network.name === "robinhoodTestnet"
    ? "https://explorer.testnet.chain.robinhood.com"
    : "https://sepolia.arbiscan.io";
  console.log("\nExplorer links (paste these into the submission, not a screenshot):");
  console.log(`  Safe:                 ${explorer}/address/${safeAddress}`);
  console.log(`  Safe creation:        ${explorer}/tx/${createReceipt.hash}`);
  console.log(`  Guard install:        ${explorer}/tx/${installReceipt.hash}`);
  console.log(`  Allowed spend:        ${explorer}/tx/${allowedReceipt?.hash ?? ""}`);
  console.log("\nThen repoint the manifest so the app and the API agree with the chain:");
  console.log("  npm run repoint");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
