import { defineConfig } from "vitest/config";

// Packages test their own contracts without the app's platform mocks or store.
export function definePackageConfig(root: string, name: string) {
  return defineConfig({
    root,
    test: {
      name,
      include: ["src/**/*.test.ts"],
      environment: "node",
      globals: true,
      pool: "threads",
      maxWorkers: 2,
      sequence: { groupOrder: 1 },
    },
  });
}
