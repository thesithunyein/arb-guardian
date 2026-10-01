/**
 * Every `/api/...` path the app fetches must exist as a handler.
 *
 * This exists because it did not, and the bug was live: a rename of the treasury roster
 * produced `/api/treasurys` in the client while the handler is `api/treasuries.ts`. Locally
 * that returns the SPA fallback with a happy 200; in production it is a 404 the user sees as
 * a silently empty list. Nothing in the build, the typecheck or the test suite noticed,
 * because the fetch path is a string.
 *
 * Vercel maps `api/foo.ts` to `/api/foo` and `api/foo/index.ts` to `/api/foo`, so the rule is
 * a direct one. Exits non-zero on any route without a handler.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const API_DIR = join(ROOT, "api");
const WEB_SRC = join(ROOT, "apps", "web", "src");

/** Literal `/api/...` paths, plus the template form `${API_BASE}/path`. */
const ROUTE_PATTERNS = [/`\$\{API_BASE\}([^`?]*)/g, /["'`]\/api\/([a-z0-9\-/[\]]*)["'`]/gi];

function sourceFiles(dir) {
  const out = [];
  const walk = (current) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

/** The set of routes the deployed API actually serves. */
function handlerRoutes() {
  const routes = new Set();
  const walk = (dir, prefix = "") => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        // `api/incidents/audit.ts` → /api/incidents/audit; `api/incidents/index.ts` → /api/incidents
        if (entry !== "node_modules" && !entry.startsWith("_") && entry !== "[id]") {
          walk(full, `${prefix}${entry}/`);
        }
        if (entry === "[id]") walk(full, `${prefix}[id]/`);
        continue;
      }
      if (!entry.endsWith(".ts")) continue;
      if (entry.startsWith("_")) continue; // shared helpers, not routes
      const base = entry.replace(/\.ts$/, "");
      routes.add(`/api/${prefix}${base === "index" ? "" : base}`.replace(/\/$/, "") || "/api");
    }
  };
  walk(API_DIR);
  return routes;
}

const routes = handlerRoutes();
const used = new Map(); // route -> [files]

for (const file of sourceFiles(WEB_SRC)) {
  const source = readFileSync(file, "utf8");
  for (const pattern of ROUTE_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const raw = (match[1] ?? "").trim();
      if (!raw) continue;
      // `/api/incidents/${id}/action` matches the dynamic handler `api/incidents/[id]/action.ts`.
      const route = `/api/${raw.replace(/^\/+/, "").replace(/\$\{[^}]*\}/g, "[id]")}`.replace(
        /\/$/,
        ""
      );
      if (!route.startsWith("/api/")) continue;
      const files = used.get(route) ?? new Set();
      files.add(relative(ROOT, file).replace(/\\/g, "/"));
      used.set(route, files);
    }
  }
}

const missing = [...used.entries()].filter(([route]) => !routes.has(route));

console.log(`API handlers: ${routes.size}`);
for (const route of [...used.keys()].sort()) {
  const handled = routes.has(route);
  console.log(`  ${handled ? "ok  " : "MISS"} ${route}  (${[...used.get(route)].join(", ")})`);
}

if (missing.length > 0) {
  console.error("\nThe app calls a route with no handler. Vercel would answer 404:");
  for (const [route] of missing) console.error(`  ${route}`);
  process.exit(1);
}

console.log("\nEvery route the app calls has a handler.");
