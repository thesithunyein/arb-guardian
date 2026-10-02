import { defineConfig } from "vitest/config";

/**
 * The serverless `api/` layer is bundled by Vercel and typechecked by `api/tsconfig.json`, but
 * it lived outside every vitest project — so the merge semantics that decide whether an
 * incident survives a cold start had no test at all. This project covers just that layer.
 */
export default defineConfig({
  test: {
    include: ["api/**/*.test.ts"],
    environment: "node"
  }
});
