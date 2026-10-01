import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ethers, network } from "hardhat";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

/**
 * Reproducible evidence pack.
 *
 *   npm run evidence -w packages/contracts
 *
 * Deploys a **real Gnosis Safe v1.4.1** plus the Arb Guardian policy stack on an in-process
 * chain, installs `SafeTreasuryGuard` the only way a real Safe allows it (an owner-approved
 * `execTransaction` self-call), then attempts a list of spends and records whether each one
 * was allowed or blocked, with the exact revert reason.
 *
 * Output:
 *   evidence/guard-proof.md    human-readable, submission-ready
 *   evidence/guard-proof.json  machine-readable, for the API/UI
 *
 * The first case is deliberately run BEFORE the guard is installed, so the pack shows the
 * same spend succeeding and then being refused. That contrast is the proof; a screenshot of
 * a blocked transaction on its own proves nothing.
 *
 * Nothing here touches a live chain. It exits non-zero if any case does not behave as
 * expected, so it is safe to wire into CI.
 */
const SAFE_ARTIFACTS = resolve(
  __dirname,
  "..",
  "node_modules",
  "@safe-global",
  "safe-contracts",
  "build",
  "artifacts",
  "contracts"
);

function safeArtifact(relPath: string): { abi: unknown[]; bytecode: string } {
  const raw = JSON.parse(readFileSync(resolve(SAFE_ARTIFACTS, relPath), "utf8"));
  return { abi: raw.abi, bytecode: raw.bytecode };
}

type Case = {
  id: string;
  description: string;
  expected: "allowed" | "blocked";
  outcome: "allowed" | "blocked" | "error";
  reason: string;
  pass: boolean;
};

function extractReason(message: string): string {
  const custom = message.match(/custom error '([^']+)'/);
  if (custom) return custom[1];
  const reverted = message.match(/reverted with reason string '([^']+)'/);
  if (reverted) return reverted[1];
  return message.split("\n")[0].slice(0, 160);
}

async function main() {
  const SAFE = safeArtifact("Safe.sol/Safe.json");
  const PROXY_FACTORY = safeArtifact("proxies/SafeProxyFactory.sol/SafeProxyFactory.json");
  const FALLBACK_HANDLER = safeArtifact(
    "handler/CompatibilityFallbackHandler.sol/CompatibilityFallbackHandler.json"
  );

  const safeInterface = new ethers.Interface(SAFE.abi as never);
  const erc20Interface = new ethers.Interface([
    "function transfer(address to, uint256 amount)",
    "function transferFrom(address from, address to, uint256 amount)",
    "function approve(address spender, uint256 amount)",
    "function mint(address to, uint256 amount)"
  ]);

  const usdgUnits = (whole: number) => BigInt(whole) * 10n ** 6n; // USDG: 6 decimals

  const signers = await ethers.getSigners();
  const [admin, owner, vendor, outsider, usdgRecipient, usdgSpender] = signers;

  console.log(`Generating evidence pack on ${network.name}`);

  // ---------------------------------------------------------------- real Safe infra
  const singleton = await new ethers.ContractFactory(SAFE.abi as never, SAFE.bytecode, admin).deploy();
  await singleton.waitForDeployment();
  const proxyFactory = await new ethers.ContractFactory(
    PROXY_FACTORY.abi as never,
    PROXY_FACTORY.bytecode,
    admin
  ).deploy();
  await proxyFactory.waitForDeployment();
  const fallbackHandler = await new ethers.ContractFactory(
    FALLBACK_HANDLER.abi as never,
    FALLBACK_HANDLER.bytecode,
    admin
  ).deploy();
  await fallbackHandler.waitForDeployment();

  const setupData = safeInterface.encodeFunctionData("setup", [
    [owner.address],
    1n,
    ethers.ZeroAddress,
    "0x",
    await fallbackHandler.getAddress(),
    ethers.ZeroAddress,
    0n,
    ethers.ZeroAddress
  ]);
  const proxyTx = await proxyFactory.createProxyWithNonce(await singleton.getAddress(), setupData, 1n);
  const proxyReceipt = await proxyTx.wait();
  let safeAddress = "";
  for (const log of proxyReceipt!.logs) {
    try {
      const parsed = proxyFactory.interface.parseLog(log as never);
      if (parsed?.name === "ProxyCreation") safeAddress = parsed.args[0];
    } catch {
      /* not our event */
    }
  }
  if (!safeAddress) throw new Error("ProxyCreation event not found");
  const safe = new ethers.Contract(safeAddress, SAFE.abi as never, owner);
  console.log(`Real Gnosis Safe: ${safeAddress}`);

  // ------------------------------------------------------------------ policy stack
  const policyFactory = await ethers.getContractFactory("PolicyManager");
  const policy = await policyFactory.deploy(admin.address);
  await policy.waitForDeployment();

  const guardFactory = await ethers.getContractFactory("SafeTreasuryGuard");
  const guard = await guardFactory.deploy(admin.address, await policy.getAddress());
  await guard.waitForDeployment();

  const usdgFactory = await ethers.getContractFactory("MockUSDG");
  const usdg = await usdgFactory.deploy();
  await usdg.waitForDeployment();
  const usdgAddress = await usdg.getAddress();

  await guard.setSafeEnrollment(safeAddress, true);
  await policy.setCounterparty(vendor.address, true);
  await policy.setWalletDailyLimit(safeAddress, ethers.parseEther("5"));

  await policy.setTokenRegistered(usdgAddress, true);
  await policy.setTokenCounterparty(usdgAddress, usdgRecipient.address, true);
  await policy.setTokenCounterparty(usdgAddress, usdgSpender.address, true);
  await policy.setTokenDailyLimit(usdgAddress, safeAddress, usdgUnits(5000));

  await admin.sendTransaction({ to: safeAddress, value: ethers.parseEther("10") });
  await usdg.mint(safeAddress, usdgUnits(100000));

  // ------------------------------------------------------------- Safe execution helper
  async function execSafeTx(
    to: string,
    value: bigint,
    data: string,
    options: { operation?: number } = {}
  ) {
    const operation = options.operation ?? 0;
    const nonce = await safe.nonce();
    const txHash: string = await safe.getTransactionHash(
      to,
      value,
      data,
      operation,
      0n,
      0n,
      0n,
      ethers.ZeroAddress,
      ethers.ZeroAddress,
      nonce
    );
    await (await safe.connect(owner).approveHash(txHash)).wait();
    const signature = ethers.concat([
      ethers.zeroPadValue(owner.address, 32),
      ethers.ZeroHash,
      "0x01"
    ]);
    return safe
      .connect(owner)
      .execTransaction(to, value, data, operation, 0n, 0n, 0n, ethers.ZeroAddress, ethers.ZeroAddress, signature);
  }

  async function attempt(
    id: string,
    description: string,
    expected: "allowed" | "blocked",
    action: () => Promise<unknown>
  ): Promise<Case> {
    try {
      const result = await action();
      if (result && typeof (result as { wait?: unknown }).wait === "function") {
        await (result as { wait: () => Promise<unknown> }).wait();
      }
      return { id, description, expected, outcome: "allowed", reason: "—", pass: expected === "allowed" };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        id,
        description,
        expected,
        outcome: "blocked",
        reason: extractReason(message),
        pass: expected === "blocked"
      };
    }
  }

  const cases: Case[] = [];

  // ---- BEFORE the guard is installed: the unsafe spend is permitted.
  cases.push(
    await attempt(
      "before_guard_unsafe_spend",
      `Before the guard is installed, the Safe pays a NON-allowlisted address ${ethers.formatEther(
        ethers.parseEther("1")
      )} ETH and the transfer settles.`,
      "allowed",
      () => execSafeTx(outsider.address, ethers.parseEther("1"), "0x")
    )
  );

  // ---- Install the guard the canonical way.
  const setGuardData = safeInterface.encodeFunctionData("setGuard", [await guard.getAddress()]);
  const installTx = await execSafeTx(safeAddress, 0n, setGuardData);
  const installReceipt = await installTx.wait();
  const guardInstalled = installReceipt?.status === 1;

  // ---- AFTER: the same class of spend is refused.
  cases.push(
    await attempt(
      "after_guard_unsafe_spend",
      "After the guard is installed, the same non-allowlisted payment is refused before it executes.",
      "blocked",
      () => execSafeTx(outsider.address, ethers.parseEther("1"), "0x")
    )
  );
  cases.push(
    await attempt(
      "native_over_daily_cap",
      "A payment to an allowlisted vendor above the 5 ETH daily cap is refused.",
      "blocked",
      () => execSafeTx(vendor.address, ethers.parseEther("6"), "0x")
    )
  );
  cases.push(
    await attempt(
      "native_within_cap",
      "A payment to an allowlisted vendor inside the cap is allowed.",
      "allowed",
      () => execSafeTx(vendor.address, ethers.parseEther("1"), "0x")
    )
  );

  // ---- USDG token lane.
  cases.push(
    await attempt(
      "usdg_within_cap",
      "The Safe pays an allowlisted recipient 1,200 USDG, inside the 5,000 USDG daily cap.",
      "allowed",
      () =>
        execSafeTx(
          usdgAddress,
          0n,
          erc20Interface.encodeFunctionData("transfer", [usdgRecipient.address, usdgUnits(1200)])
        )
    )
  );
  cases.push(
    await attempt(
      "usdg_over_cap",
      "The Safe attempts a 6,000 USDG payment, above the 5,000 USDG daily cap.",
      "blocked",
      () =>
        execSafeTx(
          usdgAddress,
          0n,
          erc20Interface.encodeFunctionData("transfer", [usdgRecipient.address, usdgUnits(6000)])
        )
    )
  );
  cases.push(
    await attempt(
      "usdg_unlisted_recipient",
      "The Safe attempts to pay a recipient that is not allowlisted for USDG.",
      "blocked",
      () =>
        execSafeTx(
          usdgAddress,
          0n,
          erc20Interface.encodeFunctionData("transfer", [outsider.address, usdgUnits(1)])
        )
    )
  );
  cases.push(
    await attempt(
      "usdg_bounded_approval",
      "The Safe grants a bounded 250 USDG approval to an allowlisted spender.",
      "allowed",
      () =>
        execSafeTx(
          usdgAddress,
          0n,
          erc20Interface.encodeFunctionData("approve", [usdgSpender.address, usdgUnits(250)])
        )
    )
  );
  cases.push(
    await attempt(
      "usdg_unlimited_approval",
      "The Safe attempts an unlimited USDG approval — the classic drain primitive.",
      "blocked",
      () =>
        execSafeTx(
          usdgAddress,
          0n,
          erc20Interface.encodeFunctionData("approve", [usdgSpender.address, ethers.MaxUint256])
        )
    )
  );
  cases.push(
    await attempt(
      "usdg_unsupported_call",
      "The Safe attempts a non-standard call on a registered token instead of falling through.",
      "blocked",
      () =>
        execSafeTx(
          usdgAddress,
          0n,
          erc20Interface.encodeFunctionData("mint", [outsider.address, usdgUnits(1)])
        )
    )
  );
  cases.push(
    await attempt(
      "delegatecall",
      "The Safe attempts a delegatecall, which a guard must never permit.",
      "blocked",
      () => execSafeTx(vendor.address, 0n, "0x12345678", { operation: 1 })
    )
  );

  // ---- Officer freeze stops everything.
  await policy.pause();
  cases.push(
    await attempt(
      "after_officer_freeze",
      "After an officer freeze, an otherwise valid allowlisted payment is refused.",
      "blocked",
      () => execSafeTx(vendor.address, ethers.parseEther("1"), "0x")
    )
  );
  await policy.unpause();

  // ---- Deny-by-default: clearing the cap closes the lane.
  await policy.setTokenDailyLimit(usdgAddress, safeAddress, 0n);
  cases.push(
    await attempt(
      "usdg_cap_cleared_fails_closed",
      "Clearing the USDG cap to zero does not open the lane — it fails closed.",
      "blocked",
      () =>
        execSafeTx(
          usdgAddress,
          0n,
          erc20Interface.encodeFunctionData("transfer", [usdgRecipient.address, usdgUnits(1)])
        )
    )
  );

  // -------------------------------------------------------------------- constraints
  cases.push(
    await attempt(
      "owner_direct_setguard",
      "An owner calling setGuard directly (not through the Safe) is rejected by Safe 1.4.1.",
      "blocked",
      async () => safe.connect(owner).setGuard.staticCall(await guard.getAddress())
    )
  );

  // --------------------------------------------------------------------------- report
  const passed = cases.filter((c) => c.pass).length;
  const allPass = passed === cases.length;

  const generatedAt = new Date().toISOString();
  const json = {
    kind: "arb-guardian-guard-proof",
    generatedAt,
    hardhatNetwork: network.name,
    safeVersion: "1.4.1 (real contracts, not a shell)",
    addresses: {
      safe: safeAddress,
      policyManager: await policy.getAddress(),
      safeTreasuryGuard: await guard.getAddress(),
      usdg: usdgAddress,
      vendor: vendor.address,
      outsider: outsider.address,
      usdgRecipient: usdgRecipient.address,
      usdgSpender: usdgSpender.address
    },
    guardInstalledThroughExecTransaction: guardInstalled,
    summary: { total: cases.length, passed, failed: cases.length - passed },
    cases
  };

  const outDir = resolve(__dirname, "..", "evidence");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, "guard-proof.json"), JSON.stringify(json, null, 2), "utf8");

  const lines: string[] = [];
  lines.push("# Arb Guardian — Guard Proof");
  lines.push("");
  lines.push(
    `Generated ${generatedAt} by \`npm run evidence -w packages/contracts\` on the in-process \`${network.name}\` chain.`
  );
  lines.push("");
  lines.push(
    "This is a reproduction, not a recording. Every row below was produced by executing the " +
      "transaction against a **real Gnosis Safe v1.4.1** (real singleton, real proxy factory, real " +
      "fallback handler) with `SafeTreasuryGuard` installed as its guard."
  );
  lines.push("");
  lines.push("## How to reproduce");
  lines.push("");
  lines.push("```bash");
  lines.push("git clone https://github.com/thesithunyein/arb-guardian");
  lines.push("cd arb-guardian && npm install");
  lines.push("npm run evidence -w packages/contracts");
  lines.push("```");
  lines.push("");
  lines.push(
    "The script exits non-zero if any case does not behave as expected, so the table below cannot " +
      "silently drift from the contracts."
  );
  lines.push("");
  lines.push(`## Result: ${passed}/${cases.length} cases behaved as specified`);
  lines.push("");
  lines.push("| # | Case | Expected | Observed | Revert reason |");
  lines.push("| ---: | --- | --- | --- | --- |");
  cases.forEach((c, i) => {
    const mark = c.pass ? "" : " ❌";
    lines.push(`| ${i + 1} | ${c.description} | ${c.expected} | ${c.outcome}${mark} | \`${c.reason}\` |`);
  });
  lines.push("");
  lines.push("## Addresses used in this run");
  lines.push("");
  lines.push("| Contract | Address |");
  lines.push("| --- | --- |");
  lines.push(`| Gnosis Safe v1.4.1 (proxy) | \`${safeAddress}\` |`);
  lines.push(`| PolicyManager | \`${await policy.getAddress()}\` |`);
  lines.push(`| SafeTreasuryGuard | \`${await guard.getAddress()}\` |`);
  lines.push(`| USDG-shaped test token (6 dp) | \`${usdgAddress}\` |`);
  lines.push("");
  lines.push("## Why the first row matters");
  lines.push("");
  lines.push(
    "Row 1 is the same payment as row 2, executed **before** the guard was installed. It settles. " +
      "Row 2 is refused. A screenshot of a blocked transaction proves nothing on its own; the " +
      "before/after pair is what shows the guard is the thing making the difference."
  );
  lines.push("");
  lines.push(
    "The guard is installed the only way Safe 1.4.1 permits: `GuardManager.setGuard` is " +
      "`SelfAuthorized`, so it must arrive as an owner-approved `execTransaction` that calls the " +
      "Safe itself. The final row confirms a direct call from an owner is rejected."
  );
  lines.push("");
  lines.push("## Live testnet deployments");
  lines.push("");
  lines.push(
    "Addresses for Arbitrum Sepolia and Robinhood Chain Testnet: [`docs/live-deployment.md`](../../docs/live-deployment.md)."
  );
  lines.push("");

  writeFileSync(resolve(outDir, "guard-proof.md"), lines.join("\n"), "utf8");

  console.log(`\nWrote ${resolve(outDir, "guard-proof.md")}`);
  console.log(`Wrote ${resolve(outDir, "guard-proof.json")}`);
  console.log(`\n${passed}/${cases.length} cases behaved as specified.`);
  if (!allPass) {
    for (const c of cases.filter((x) => !x.pass)) {
      console.error(`  NOT AS EXPECTED: ${c.id} — expected ${c.expected}, observed ${c.outcome} (${c.reason})`);
    }
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
