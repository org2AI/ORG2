const view = "^src/(components|scaffold|modules)/";
const test = "(^src/test/|/__tests__/|\\.(test|spec)\\.)";
module.exports = {
  forbidden: [
    {
      name: "production-to-tests",
      severity: "error",
      from: { path: "^src/", pathNot: test },
      to: { path: test },
    },
    {
      name: "api-to-view",
      severity: "error",
      from: { path: "^src/api/", pathNot: test },
      to: { path: view },
    },
    {
      name: "session-core-to-view",
      severity: "error",
      from: { path: "^src/engines/SessionCore/core/", pathNot: test },
      to: { path: view },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "\\.(css|scss|svg|png|jpg|woff2?)$" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },
  },
};
