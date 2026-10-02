/**
 * Read `.env` files, the way the rest of this repository already reads secrets.
 *
 * The hardhat config loads `.env` before it looks for an explorer key, so "put the key in `.env`" is
 * the instruction this project has always given. A plain `node scripts/...` invocation does not do
 * that on its own, which means the key would sit in the file while the script that needs it reported
 * the key as absent — the most likely way for "just add the key" to quietly not work.
 *
 * Dependency-free and deliberately small: `KEY=value` lines, optional surrounding quotes, `#`
 * comments, blank lines, and CRLF line endings, which is everything these files contain.
 *
 * Values already present in the environment win, so a one-off `ARBISCAN_API_KEY=... npm run ...`
 * still overrides the file that is on disk.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const unquote = (value) => {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === `"` && last === `"`) || (first === `'` && last === `'`)) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
};

/**
 * @returns {{ files: string[], names: string[] }} which files were read and which variables they
 * supplied — names only, so nothing secret can end up in a log by accident.
 */
export function loadEnvFiles(dir, files = [".env", ".env.local"]) {
  const loaded = [];
  const names = [];

  for (const file of files) {
    const path = join(dir, file);
    if (!existsSync(path)) continue;
    loaded.push(file);

    for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const equals = line.indexOf("=");
      if (equals <= 0) continue;

      const key = line.slice(0, equals).trim().replace(/^export\s+/, "");
      if (!key || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
      if (process.env[key] !== undefined && process.env[key] !== "") continue;

      const value = unquote(line.slice(equals + 1));
      if (value === "") continue;
      process.env[key] = value;
      names.push(key);
    }
  }

  return { files: loaded, names };
}
