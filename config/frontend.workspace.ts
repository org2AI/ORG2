export default [
  { extends: true as const, test: { name: "app" } },
  "packages/*/vitest.config.ts",
];
