import { execSync } from "node:child_process";

const allowPatterns = [/(^|\/)\.env\.example$/];

const bannedPatterns = [
  /(^|\/)\.env$/,
  /(^|\/)\.env\.(?!example$).+/,
  /node_modules\//,
  /(^|\/)dist\//,
  /artifacts\//,
  /(^|\/)cache\//,
  /typechain-types\//,
  /apps\/api\/data\//,
  /packages\/contracts\/deployments\//,
  /docs\/submission-bundle\//,
  /docs\/final-submission-ready\.md$/,
  /docs\/deployment-evidence\.(md|json)$/,
  /runtime-state\.json$/,
  /\.local$/,
  /recordings\//
];

function dryRunAdd() {
  const out = execSync("git add -n -A", { encoding: "utf8" });
  return out
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("add '") || line.startsWith("add \""))
    .map((line) => line.replace(/^add ['"]/, "").replace(/['"]$/, "").replace(/\\/g, "/"));
}

const files = dryRunAdd();
const banned = [];
const allowed = [];

for (const file of files) {
  if (allowPatterns.some((re) => re.test(file))) {
    allowed.push(file);
    continue;
  }
  if (bannedPatterns.some((re) => re.test(file))) banned.push(file);
  else allowed.push(file);
}

console.log("=== PUSH-SAFE AUDIT (git add -n) ===");
console.log(`Would stage KEEP (${allowed.length}):`);
for (const f of allowed) console.log(`  KEEP  ${f}`);
console.log(`\nWould stage BANNED (${banned.length}):`);
for (const f of banned) console.log(`  SKIP  ${f}`);

if (banned.length > 0) {
  console.error("\nFail: banned files would be staged. Fix .gitignore before commit.");
  process.exitCode = 1;
} else if (allowed.length === 0) {
  console.log("\nNo files to stage.");
} else {
  console.log("\nPass: dry-run stage set is real-product only.");
}
