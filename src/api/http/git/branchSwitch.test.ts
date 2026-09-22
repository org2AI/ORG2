import { beforeEach, expect, it, vi } from "vitest";

import { branchSwitchApi } from "./branchSwitch";

const fetchRustApi = vi.hoisted(() => vi.fn());
vi.mock("./client", () => ({
  fetchRustApi,
  gitRepoUrl: (repo: string) => `/repo/${encodeURIComponent(repo)}`,
}));
beforeEach(() => vi.resetAllMocks());
it("serializes creation, base, fingerprint and strategy in one mutation", async () => {
  fetchRustApi.mockResolvedValue({ data: { outcome: "switched" } });
  await branchSwitchApi.execute(
    { repoId: "repo", repoPath: "/tree" },
    { branch: "feature", create: true, start_point: "main" },
    "fingerprint",
    "bring"
  );
  expect(fetchRustApi).toHaveBeenCalledWith(
    "/repo/repo/branch-switch/execute?path=%2Ftree",
    {
      method: "POST",
      body: JSON.stringify({
        target: { branch: "feature", create: true, start_point: "main" },
        fingerprint: "fingerprint",
        strategy: "bring",
      }),
    }
  );
});
