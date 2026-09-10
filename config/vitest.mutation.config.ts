import path from "node:path";
import { defineConfig } from "vitest/config";

// This pure decision helper needs neither the application graph nor global mocks.
export default defineConfig({
  root: path.resolve(__dirname, ".."),
  test: {
    include: [
      "src/engines/SessionCore/control/__tests__/sessionTimelineBoundaryHelpers.test.ts",
    ],
    environment: "node",
    pool: "threads",
    poolOptions: { threads: { minThreads: 1, maxThreads: 1 } },
  },
});
