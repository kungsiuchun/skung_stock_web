module.exports = {
  root: true,
  env: {
    browser: true,
    es2021: true,
    node: true,
  },
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    ecmaFeatures: {
      jsx: true,
    },
  },
  plugins: ["@typescript-eslint", "react-hooks"],
  extends: ["eslint:recommended"],
  ignorePatterns: ["dist/", "node_modules/", ".wrangler/", "uat_screenshots/"],
  rules: {
    // TypeScript resolves type-only DOM and Worker names; ESLint's core rule
    // cannot distinguish them from runtime identifiers.
    "no-undef": "off",
    "no-unused-vars": "off",
    "@typescript-eslint/no-unused-vars": ["error", {
      argsIgnorePattern: "^_",
      varsIgnorePattern: "^_",
    }],
    "@typescript-eslint/no-duplicate-enum-values": "error",
    "@typescript-eslint/no-non-null-asserted-optional-chain": "error",
    "react-hooks/rules-of-hooks": "error",
    // Existing API adapters and fixture-heavy tests use `any` pervasively.
    // Tightening this requires a dedicated migration, not a silent mass rewrite.
    "@typescript-eslint/no-explicit-any": "off",
    // Dependency corrections change runtime behaviour and are reviewed per component.
    "react-hooks/exhaustive-deps": "off",
  },
};
