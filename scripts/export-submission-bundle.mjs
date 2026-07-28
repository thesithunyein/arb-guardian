import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const bundleDir = resolve(root, "docs", "submission-bundle");

const requiredFiles = [
  "docs/final-submission-ready.md",
  "docs/final-submission-copy.md",
  "docs/judging-evidence-matrix.md",
  "docs/demo-timing-track.md",
  "docs/demo-runbook.md",
  "docs/judge-brief.md",
  "docs/grant-milestones.md",
  "docs/prize-optimization.md",
  "docs/production-readiness-checklist.md",
  "docs/security-ops-runbook.md",
  "docs/submission-package.md"
];

const optionalFiles = [
  "docs/deployment-evidence.md",
  "docs/deployment-evidence.json"
];

const commandProof = [
  "npm run preflight",
  "npm run quality:gate",
  "npm run demo:smoke",
  "npm run demo:seed"
];

function ensureFinalSubmissionReady() {
  const readyPath = resolve(root, "docs", "final-submission-ready.md");
  if (!existsSync(readyPath)) {
    throw new Error("Missing docs/final-submission-ready.md. Run `npm run submission:finalize` first.");
  }
}

function checkFiles() {
  const missing = requiredFiles.filter((f) => !existsSync(resolve(root, f)));
  if (missing.length > 0) {
    throw new Error(`Missing required files:\n${missing.join("\n")}`);
  }
}

function generateManifest() {
  const generatedAt = new Date().toISOString();
  const lines = [
    "# Submission Bundle Manifest",
    "",
    `GeneratedAt: ${generatedAt}`,
    "",
    "## Included Files"
  ];
  for (const file of requiredFiles) {
    lines.push(`- ${file}`);
  }
  lines.push("", "## Optional Deployment Files (included if present)");
  for (const file of optionalFiles) {
    lines.push(`- ${file}`);
  }
  lines.push("", "## Recommended Verification Commands");
  for (const cmd of commandProof) {
    lines.push(`- ${cmd}`);
  }

  return lines.join("\n");
}

function exportBundle() {
  if (existsSync(bundleDir)) {
    rmSync(bundleDir, { recursive: true, force: true });
  }
  mkdirSync(bundleDir, { recursive: true });

  for (const rel of requiredFiles) {
    const from = resolve(root, rel);
    const to = resolve(bundleDir, rel.replace(/^docs[\\/]/, ""));
    mkdirSync(resolve(to, ".."), { recursive: true });
    cpSync(from, to);
  }

  for (const rel of optionalFiles) {
    const from = resolve(root, rel);
    if (!existsSync(from)) continue;
    const to = resolve(bundleDir, rel.replace(/^docs[\\/]/, ""));
    mkdirSync(resolve(to, ".."), { recursive: true });
    cpSync(from, to);
  }

  writeFileSync(resolve(bundleDir, "manifest.md"), generateManifest(), "utf8");

  const finalReady = readFileSync(resolve(root, "docs", "final-submission-ready.md"), "utf8");
  writeFileSync(resolve(bundleDir, "SUBMIT_THIS.md"), finalReady, "utf8");
}

try {
  ensureFinalSubmissionReady();
  checkFiles();
  exportBundle();
  console.log("Exported docs/submission-bundle");
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
}
