import tseslint from "typescript-eslint";

/**
 * Shared ESLint config for every workspace.
 *
 * This is deliberately a **parse-level** gate: before it existed, `npm run lint` died with
 * "Parsing error: Unexpected token type" because the default parser cannot read TypeScript, so
 * the command was a broken promise rather than a check. It now parses TypeScript and applies the
 * small rule set below.
 *
 * Turning on `tseslint.configs.recommended` would be the next step; it is not on here because the
 * existing code has not been brought up to that bar and a lint gate that fails on arrival gets
 * ignored. Contracts are linted separately and much more strictly by solhint
 * (`packages/contracts/.solhint.json`).
 */
export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/artifacts/**", "**/cache/**"]
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2022,
      sourceType: "module"
    },
    rules: {
      "no-console": "off",
      "no-debugger": "error",
      "no-dupe-keys": "error",
      "no-duplicate-case": "error",
      "no-unreachable": "error",
      "no-unsafe-negation": "error",
      "valid-typeof": "error"
    }
  }
);
