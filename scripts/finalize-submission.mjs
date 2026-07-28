import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

function loadDotEnv(filePath) {
  try {
    const raw = readFileSync(filePath, "utf8");
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      if (!line || line.trim().startsWith("#")) continue;
      const idx = line.indexOf("=");
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // ignore missing .env
  }
}

loadDotEnv(resolve(process.cwd(), ".env"));

const substitutions = {
  "<fill_web_url>": process.env.SUBMISSION_WEB_URL ?? "<fill_web_url>",
  "<fill_api_url>": process.env.SUBMISSION_API_URL ?? "<fill_api_url>",
  "<fill_demo_url>": process.env.SUBMISSION_DEMO_URL ?? "<fill_demo_url>",
  "<fill_repo_url>": process.env.SUBMISSION_REPO_URL ?? "<fill_repo_url>",
  "<fill_policy_address>": process.env.SUBMISSION_POLICY_MANAGER_ADDRESS ?? "<fill_policy_address>",
  "<fill_guard_address>": process.env.SUBMISSION_EXECUTION_GUARD_ADDRESS ?? "<fill_guard_address>",
  "<fill_policy_tx>": process.env.SUBMISSION_POLICY_MANAGER_TX ?? "<fill_policy_tx>",
  "<fill_guard_tx>": process.env.SUBMISSION_EXECUTION_GUARD_TX ?? "<fill_guard_tx>"
};

const source = resolve(process.cwd(), "docs", "final-submission-copy.md");
const output = resolve(process.cwd(), "docs", "final-submission-ready.md");
let content = readFileSync(source, "utf8");

for (const [token, value] of Object.entries(substitutions)) {
  content = content.replaceAll(token, value);
}

writeFileSync(output, content, "utf8");
console.log("Generated docs/final-submission-ready.md");
