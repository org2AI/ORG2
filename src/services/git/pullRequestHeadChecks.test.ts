import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GitHubChecksSummary } from "@src/api/tauri/github";

import {
  PULL_REQUEST_HEAD_CHECKS_REUSE_MS,
  clearPullRequestHeadChecks,
  invalidatePullRequestHeadChecks,
  loadPullRequestHeadChecks,
  primePullRequestHeadChecks,
  pullRequestHeadChecksEpoch,
  subscribePullRequestHeadChecks,
} from "./pullRequestHeadChecks";

const apiMocks = vi.hoisted(() => ({
  getChecksLocal: vi.fn(),
  getPRLocal: vi.fn(),
}));
vi.mock("@src/api/tauri/github", () => apiMocks);

const REPO = "org/repo";
const PR = 7;

function checks(state: string): GitHubChecksSummary {
  return { sha: "head", state, check_runs: [], statuses: [] };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-20T00:00:00Z"));
  vi.clearAllMocks();
  clearPullRequestHeadChecks();
  apiMocks.getPRLocal.mockResolvedValue({ head: { sha: "head" } });
  apiMocks.getChecksLocal.mockResolvedValue(checks("pending"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("loadPullRequestHeadChecks", () => {
  it("reads the pull request, then the checks on its head", async () => {
    const result = await loadPullRequestHeadChecks(REPO, PR);

    expect(apiMocks.getPRLocal).toHaveBeenCalledWith(REPO, PR);
    expect(apiMocks.getChecksLocal).toHaveBeenCalledWith(REPO, "head");
    expect(result).toMatchObject({
      headSha: "head",
      checks: checks("pending"),
    });
  });

  it("answers concurrent callers from one request", async () => {
    const gate = deferred<Record<string, unknown>>();
    apiMocks.getPRLocal.mockReturnValue(gate.promise);

    const first = loadPullRequestHeadChecks(REPO, PR);
    const second = loadPullRequestHeadChecks(REPO, PR);
    expect(second).toBe(first);
    gate.resolve({ head: { sha: "head" } });
    await first;

    expect(apiMocks.getPRLocal).toHaveBeenCalledTimes(1);
    expect(apiMocks.getChecksLocal).toHaveBeenCalledTimes(1);
  });

  it("keeps different pull requests apart", async () => {
    await Promise.all([
      loadPullRequestHeadChecks(REPO, PR),
      loadPullRequestHeadChecks(REPO, PR + 1),
      loadPullRequestHeadChecks("org/other", PR),
    ]);
    expect(apiMocks.getPRLocal).toHaveBeenCalledTimes(3);
  });

  it("lets a scheduled poll take a recent answer, and always asks when none is recent enough", async () => {
    const first = await loadPullRequestHeadChecks(REPO, PR);

    vi.advanceTimersByTime(PULL_REQUEST_HEAD_CHECKS_REUSE_MS);
    await expect(
      loadPullRequestHeadChecks(REPO, PR, {
        maxAgeMs: PULL_REQUEST_HEAD_CHECKS_REUSE_MS,
      })
    ).resolves.toMatchObject({ checks: first.checks, detail: first.detail });
    expect(apiMocks.getPRLocal).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    await loadPullRequestHeadChecks(REPO, PR, {
      maxAgeMs: PULL_REQUEST_HEAD_CHECKS_REUSE_MS,
    });
    expect(apiMocks.getPRLocal).toHaveBeenCalledTimes(2);
  });

  it("always reaches GitHub for a read someone asked for", async () => {
    await loadPullRequestHeadChecks(REPO, PR);
    await loadPullRequestHeadChecks(REPO, PR);
    expect(apiMocks.getPRLocal).toHaveBeenCalledTimes(2);
  });

  it("publishes each accepted answer once, naming who asked, and survives a listener that throws", async () => {
    const heard = vi.fn();
    const unsubscribeBroken = subscribePullRequestHeadChecks(() => {
      throw new Error("listener bug");
    });
    const unsubscribe = subscribePullRequestHeadChecks(heard);
    const source = {};

    const result = await loadPullRequestHeadChecks(REPO, PR, { source });
    await loadPullRequestHeadChecks(REPO, PR, { maxAgeMs: 60_000 });

    expect(heard).toHaveBeenCalledTimes(1);
    expect(heard).toHaveBeenCalledWith({
      repoFullName: REPO,
      prNumber: PR,
      snapshot: result,
      source,
    });

    unsubscribe();
    unsubscribeBroken();
    await loadPullRequestHeadChecks(REPO, PR);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("does not cache or share a failed read", async () => {
    apiMocks.getPRLocal.mockRejectedValueOnce(new Error("network"));
    await expect(loadPullRequestHeadChecks(REPO, PR)).rejects.toThrow(
      "network"
    );

    await expect(
      loadPullRequestHeadChecks(REPO, PR, { maxAgeMs: 60_000 })
    ).resolves.toMatchObject({ headSha: "head" });
    expect(apiMocks.getPRLocal).toHaveBeenCalledTimes(2);
  });

  it("reports a pull request without a head instead of guessing its checks", async () => {
    apiMocks.getPRLocal.mockResolvedValue({ head: null });
    await expect(loadPullRequestHeadChecks(REPO, PR)).resolves.toMatchObject({
      headSha: null,
      checks: null,
    });
    expect(apiMocks.getChecksLocal).not.toHaveBeenCalled();
  });
});

describe("changes to the pull request", () => {
  it("forgets the cached answer once the pull request is invalidated", async () => {
    await loadPullRequestHeadChecks(REPO, PR);
    invalidatePullRequestHeadChecks(REPO, PR);

    await loadPullRequestHeadChecks(REPO, PR, { maxAgeMs: 60_000 });
    expect(apiMocks.getPRLocal).toHaveBeenCalledTimes(2);
  });

  it("neither joins nor caches a request dispatched before the invalidation", async () => {
    const stale = deferred<Record<string, unknown>>();
    apiMocks.getPRLocal.mockReturnValueOnce(stale.promise);
    const before = loadPullRequestHeadChecks(REPO, PR);

    invalidatePullRequestHeadChecks(REPO, PR);
    apiMocks.getChecksLocal.mockResolvedValue(checks("success"));
    const after = loadPullRequestHeadChecks(REPO, PR);
    expect(after).not.toBe(before);
    await after;

    apiMocks.getChecksLocal.mockResolvedValue(checks("pending"));
    stale.resolve({ head: { sha: "head" } });
    await before;

    const reused = await loadPullRequestHeadChecks(REPO, PR, {
      maxAgeMs: 60_000,
    });
    expect(reused.checks?.state).toBe("success");
  });

  it("can refuse to join a request that may predate a push", async () => {
    const slow = deferred<Record<string, unknown>>();
    apiMocks.getPRLocal.mockReturnValueOnce(slow.promise);
    const old = loadPullRequestHeadChecks(REPO, PR);

    apiMocks.getChecksLocal.mockResolvedValue(checks("success"));
    const fresh = loadPullRequestHeadChecks(REPO, PR, { bypassInFlight: true });
    expect(fresh).not.toBe(old);
    await fresh;

    // The slow, older request lands last and must not replace the newer one.
    apiMocks.getChecksLocal.mockResolvedValue(checks("pending"));
    slow.resolve({ head: { sha: "head" } });
    await old;
    const reused = await loadPullRequestHeadChecks(REPO, PR, {
      maxAgeMs: 60_000,
    });
    expect(reused.checks?.state).toBe("success");
  });

  it("shares what a full detail load read, unless the pull request changed since that load began", async () => {
    const epoch = pullRequestHeadChecksEpoch(REPO, PR);
    const snapshot = {
      detail: { head: { sha: "head" } },
      headSha: "head",
      checks: checks("success"),
    };

    primePullRequestHeadChecks(REPO, PR, snapshot, epoch);
    const reused = await loadPullRequestHeadChecks(REPO, PR, {
      maxAgeMs: 60_000,
    });
    expect(reused.checks?.state).toBe("success");
    expect(apiMocks.getPRLocal).not.toHaveBeenCalled();

    invalidatePullRequestHeadChecks(REPO, PR);
    primePullRequestHeadChecks(REPO, PR, snapshot, epoch);
    await loadPullRequestHeadChecks(REPO, PR, { maxAgeMs: 60_000 });
    expect(apiMocks.getPRLocal).toHaveBeenCalledTimes(1);
  });
});
