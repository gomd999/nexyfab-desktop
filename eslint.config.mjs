import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "out2/**",
    "build/**",
    "next-env.d.ts",
  ]),
  /**
   * Gradual cleanup: the repo predates strict `any` / internal-`<a>` enforcement.
   * Keep as warnings so `npm run lint` stays actionable; tighten back to error over time.
   */
  {
    files: ["src/**/*.{js,jsx,ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@next/next/no-html-link-for-pages": "warn",
      "@typescript-eslint/no-require-imports": "warn",
      /** `_foo` / catch `_err` — intentional unused; keeps signal on real dead code */
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          args: "after-used",
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "all",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      /** React 19 compiler rules — enable as errors incrementally */
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/static-components": "warn",
    },
  },
  /** Tests use loose fixtures & mocks — `any` adds noise without product signal */
  {
    files: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "src/**/__tests__/**/*.{ts,tsx}",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  /** Manufacturing simulator prototype — typed gradually */
  {
    files: ["src/app/**/simulator/page.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  /** Monolithic shell: dependency arrays are curated for perf / intentional staleness */
  {
    files: ["src/app/**/shape-generator/ShapeGeneratorInner.tsx"],
    rules: {
      "react-hooks/exhaustive-deps": "off",
    },
  },
  /** CAD workspace: imperative init / ref syncing triggers React Compiler hook warnings without matching real bugs */
  {
    files: ["src/app/**/shape-generator/**/*.{tsx,ts}"],
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
    },
  },
  /** Screenshots, blobs, canvas exports — native `<img>` avoids optimizer edge cases (`[lang]` must not be a glob char class — use `**`) */
  {
    files: [
      "src/app/**/shape-generator/**/*.{tsx,ts}",
      "src/app/admin/**/*.{tsx,ts}",
      "src/app/**/dashboard/**/*.{tsx,ts}",
      "src/app/**/nexyfab/**/*.{tsx,ts}",
      "src/app/**/quick-quote/**/*.{tsx,ts}",
      "src/app/partner/orders/**/*.{tsx,ts}",
    ],
    rules: {
      "@next/next/no-img-element": "off",
    },
  },
]);

export default eslintConfig;
