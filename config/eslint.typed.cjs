const path = require("node:path");

// Separate from editor lint: build one type graph for these three rules only.
module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: "./tsconfig.json",
    tsconfigRootDir: path.resolve(__dirname, ".."),
    ecmaVersion: "latest",
    sourceType: "module",
  },
  plugins: ["@typescript-eslint"],
  ignorePatterns: [
    "**/*.test.*",
    "**/*.spec.*",
    "**/__tests__/**",
    "**/*.d.ts",
  ],
  rules: {
    "@typescript-eslint/no-floating-promises": ["error", { ignoreVoid: false }],
    "@typescript-eslint/no-misused-promises": "error",
    "@typescript-eslint/switch-exhaustiveness-check": "error",
  },
};
