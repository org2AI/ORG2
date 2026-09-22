export default {
  mutate: ["src/engines/SessionCore/control/sessionTimelineBoundaryHelpers.ts"],
  files: [
    "package.json",
    "config/vitest.mutation.config.ts",
    "src/engines/SessionCore/control/sessionTimelineBoundaryHelpers.ts",
    "src/engines/SessionCore/control/__tests__/sessionTimelineBoundaryHelpers.test.ts",
  ],
  testRunner: "vitest",
  plugins: ["@stryker-mutator/vitest-runner"],
  // The dedicated config already selects exactly the mutation boundary tests.
  vitest: { configFile: "config/vitest.mutation.config.ts", related: false },
  concurrency: 1,
  coverageAnalysis: "perTest",
  reporters: ["clear-text", "json"],
  jsonReporter: { fileName: "node_modules/.cache/stryker/report.json" },
  tempDirName: "node_modules/.cache/stryker/sandbox",
  thresholds: { high: 100, low: 100, break: 100 },
  timeoutMS: 5000,
};
