module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true,
  },
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
  },
  plugins: ["@typescript-eslint"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  ignorePatterns: ["dist/", "node_modules/", "bin/"],
  rules: {
    // Empty catch blocks are used deliberately throughout for best-effort
    // operations (logging, cleanup, config edits).
    "no-empty": ["error", { allowEmptyCatch: true }],
    // The plugin bridges loosely-typed OpenCode plugin inputs; `any` is
    // intentional at those boundaries and narrowed immediately.
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unused-vars": [
      "warn",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
    ],
  },
};
