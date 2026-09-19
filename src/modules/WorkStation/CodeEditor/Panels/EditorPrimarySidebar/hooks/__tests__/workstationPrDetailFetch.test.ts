import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchPrDetailBundle } from "../workstationPrDetailFetch";

const apiMocks = vi.hoisted(() => ({
  getChecksLocal: vi.fn(),
  getDeploymentsLocal: vi.fn(),
  getPRLocal: vi.fn(),
  listIssueCommentsLocal: vi.fn(),
  listIssueTimelineLocal: vi.fn(),
  listPRCommitsLocal: vi.fn(),
  listPRFilesLocal: vi.fn(),
  listPrReviewCommentsLocal: vi.fn(),
  listPrReviewsLocal: vi.fn(),
}));

vi.mock("@src/api/tauri/github", () => apiMocks);

const REPO = "org/repo";
const CHECKS = {
  sha: "head-sha",
  check_runs: [],
  statuses: [],
  state: "success",
};
const DEPLOYMENTS = {
  git_ref: "feat/box",
  repo_has_deployments: true,
  deployments: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  for (const list of [
    apiMocks.listIssueCommentsLocal,
    apiMocks.listIssueTimelineLocal,
    apiMocks.listPRCommitsLocal,
    apiMocks.listPRFilesLocal,
    apiMocks.listPrReviewCommentsLocal,
    apiMocks.listPrReviewsLocal,
  ]) {
    list.mockResolvedValue([]);
  }
  apiMocks.getPRLocal.mockResolvedValue({
    head: { sha: "head-sha", ref: "feat/box" },
    base: { ref: "develop" },
  });
  apiMocks.getChecksLocal.mockResolvedValue(CHECKS);
  apiMocks.getDeploymentsLocal.mockResolvedValue(DEPLOYMENTS);
});

describe("fetchPrDetailBundle", () => {
  it("reads checks by the head sha and deployments by the head branch", async () => {
    const bundle = await fetchPrDetailBundle(REPO, 7);

    expect(apiMocks.getChecksLocal).toHaveBeenCalledWith(REPO, "head-sha");
    expect(apiMocks.getDeploymentsLocal).toHaveBeenCalledWith(REPO, "feat/box");
    expect(bundle.checks).toBe(CHECKS);
    expect(bundle.deployments).toBe(DEPLOYMENTS);
  });

  it("loads the pull request even when deployments cannot be read", async () => {
    apiMocks.getDeploymentsLocal.mockRejectedValue(new Error("403"));

    const bundle = await fetchPrDetailBundle(REPO, 7);

    expect(bundle.deployments).toBeNull();
    expect(bundle.checks).toBe(CHECKS);
  });

  it("skips both lookups until GitHub reports a head", async () => {
    apiMocks.getPRLocal.mockResolvedValue({ head: null, base: null });

    const bundle = await fetchPrDetailBundle(REPO, 7);

    expect(apiMocks.getChecksLocal).not.toHaveBeenCalled();
    expect(apiMocks.getDeploymentsLocal).not.toHaveBeenCalled();
    expect(bundle).toMatchObject({ checks: null, deployments: null });
  });
});
