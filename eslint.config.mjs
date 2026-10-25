import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { ignoreRestSiblings: true, argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      // React Compiler rules. The existing components predate them and work; rewriting ~20 of them
      // this late risks UI regressions, so they warn instead of failing CI. Fix them when touched.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Local tooling, worktrees, build output and git-ignored probe scripts.
    ".data/**",
    ".claude/**",
    "cursor-history/**",
    "backups/**",
    "coverage/**",
    "infra/terraform/.build/**",
    "infra/terraform/.terraform/**",
    "scripts/_*.ts",
  ]),
]);

export default eslintConfig;
