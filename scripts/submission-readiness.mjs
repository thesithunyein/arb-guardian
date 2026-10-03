import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const requiredFiles = ["docs/production-readiness-checklist.md"];

/**
 * Submission paperwork and demo planning are deliberately untracked (see .gitignore). They exist on
 * the maintainer's machine and are absent from a clone, so absence is reported rather than failed.
 */
const localOnlyFiles = [
  "docs/final-submission-copy.md",
  "docs/judging-evidence-matrix.md",
  "docs/demo-timing-track.md",
  "docs/submission-package.md"
];

const placeholderTargets = [
  "docs/final-submission-copy.md",
  "docs/submission-package.md"
];

const unresolvedTokens = [
  "<fill>",
  "<fill-after-deploy>",
  "<fill_web_url>",
  "<fill_api_url>",
  "<fill_demo_url>",
  "<fill_repo_url>",
  "<fill_policy_address>",
  "<fill_guard_address>",
  "<fill_policy_tx>",
  "<fill_guard_tx>"
];

let hasFailure = false;

for (const rel of requiredFiles) {
  const abs = resolve(process.cwd(), rel);
  if (!existsSync(abs)) {
    console.error(`Missing required file: ${rel}`);
    hasFailure = true;
  }
}

const absentLocalOnly = localOnlyFiles.filter((rel) => !existsSync(resolve(process.cwd(), rel)));
if (absentLocalOnly.length > 0) {
  console.log(
    `Local-only submission docs not present in this checkout (expected): ${absentLocalOnly.join(", ")}`
  );
}

for (const rel of placeholderTargets) {
  const abs = resolve(process.cwd(), rel);
  if (!existsSync(abs)) continue;
  const content = readFileSync(abs, "utf8");
  for (const token of unresolvedTokens) {
    if (content.includes(token)) {
      console.warn(`Unresolved placeholder '${token}' found in ${rel}`);
    }
  }
}

if (hasFailure) {
  process.exitCode = 1;
} else {
  console.log("Submission readiness structure check passed.");
}
