import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

const config = [
  // Exclude build artifacts and generated files from linting
  {
    ignores: [".next/**", "out/**", "node_modules/**", "next-env.d.ts"],
  },
  ...nextVitals,
  ...nextTypeScript,
  // Downgrade pre-existing noisy rules to warnings for RC1.
  // These flag hundreds of patterns across the codebase that
  // are too risky to bulk-fix before the first stable release.
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-require-imports": "warn",
      "@typescript-eslint/no-unsafe-function-type": "warn",
      "@typescript-eslint/no-this-alias": "warn",
      "@typescript-eslint/no-empty-object-type": "warn",
      "@typescript-eslint/ban-ts-comment": "warn",
    },
  },
];

export default config;
