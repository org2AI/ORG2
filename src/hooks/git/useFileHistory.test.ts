/* @vitest-environment jsdom */
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { GitCommitInfo } from "@src/api/http/git";
import { createHookLifecycleHarness } from "@src/test/hookLifecycleHarness";

import { type UseFileHistoryOptions, useFileHistory } from "./useFileHistory";

const mocks = vi.hoisted(() => ({
  getGitCommits: vi.fn(),
}));

vi.mock("@src/api/http/git", () => ({
  getGitCommits: mocks.getGitCommits,
}));

const COMMITS = [{ sha: "abc" }, { sha: "def" }] as unknown as GitCommitInfo[];

type CommitsPayload = { commits: GitCommitInfo[]; total_count: number | null };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function flushAsync(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function createHarness() {
  return createHookLifecycleHarness((props: UseFileHistoryOptions) =>
    useFileHistory(props)
  );
}

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
  vi.clearAllMocks();
});

describe("useFileHistory", () => {
  it("loads commits and total count and reports success once", async () => {
    const request = deferred<CommitsPayload>();
    mocks.getGitCommits.mockReturnValue(request.promise);
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const harness = createHarness();
    cleanup.push(harness.unmount);

    await harness.render({
      repoId: "repo-1",
      filePath: "src/a.ts",
      limit: 10,
      onSuccess,
      onError,
    });
    expect(harness.read()).toMatchObject({
      commits: [],
      totalCount: null,
      loading: true,
      error: null,
    });

    request.resolve({ commits: COMMITS, total_count: 7 });
    await flushAsync();
    expect(mocks.getGitCommits).toHaveBeenCalledWith({
      repo_id: "repo-1",
      file_path: "src/a.ts",
      limit: 10,
    });
    expect(harness.read()).toMatchObject({
      commits: COMMITS,
      totalCount: 7,
      loading: false,
      error: null,
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith(COMMITS);
    expect(onError).not.toHaveBeenCalled();
  });

  it("treats an empty API response as no commits without calling onSuccess", async () => {
    mocks.getGitCommits.mockResolvedValue(undefined);
    const onSuccess = vi.fn();
    const harness = createHarness();
    cleanup.push(harness.unmount);

    await harness.render({ repoId: "repo-1", filePath: "src/a.ts", onSuccess });
    await flushAsync();
    expect(harness.read()).toMatchObject({
      commits: [],
      totalCount: null,
      loading: false,
      error: null,
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("does not fetch without a file path", async () => {
    const harness = createHarness();
    cleanup.push(harness.unmount);

    await harness.render({ repoId: "repo-1", filePath: null });
    await flushAsync();
    expect(mocks.getGitCommits).not.toHaveBeenCalled();
    expect(harness.read()).toMatchObject({
      commits: [],
      totalCount: null,
      loading: false,
      error: null,
    });
  });

  it("maps a rejected query to an error, clears commits and calls onError", async () => {
    mocks.getGitCommits.mockRejectedValue(new Error("network down"));
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const harness = createHarness();
    cleanup.push(harness.unmount);

    await harness.render({
      repoId: "repo-1",
      filePath: "src/a.ts",
      onSuccess,
      onError,
    });
    await flushAsync();
    expect(harness.read()).toMatchObject({
      commits: [],
      totalCount: null,
      loading: false,
      error: "network down",
    });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith("network down");
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("refreshes in place and refetches when the limit changes", async () => {
    mocks.getGitCommits.mockResolvedValue({ commits: COMMITS, total_count: 2 });
    const onSuccess = vi.fn();
    const harness = createHarness();
    cleanup.push(harness.unmount);

    await harness.render({ repoId: "repo-1", filePath: "src/a.ts", onSuccess });
    await flushAsync();
    expect(onSuccess).toHaveBeenCalledTimes(1);

    const callsBeforeRefresh = mocks.getGitCommits.mock.calls.length;
    const request = deferred<CommitsPayload>();
    mocks.getGitCommits.mockReturnValue(request.promise);
    await act(async () => harness.read().refresh());
    expect(harness.read()).toMatchObject({
      commits: [],
      totalCount: null,
      loading: true,
    });
    request.resolve({ commits: COMMITS, total_count: 2 });
    await flushAsync();
    expect(mocks.getGitCommits.mock.calls.length).toBe(callsBeforeRefresh + 1);
    expect(onSuccess).toHaveBeenCalledTimes(2);
    expect(harness.read()).toMatchObject({ commits: COMMITS, loading: false });

    mocks.getGitCommits.mockResolvedValue({ commits: COMMITS, total_count: 2 });
    await harness.render({
      repoId: "repo-1",
      filePath: "src/a.ts",
      limit: 5,
      onSuccess,
    });
    await flushAsync();
    expect(mocks.getGitCommits).toHaveBeenLastCalledWith({
      repo_id: "repo-1",
      file_path: "src/a.ts",
      limit: 5,
    });
  });
});
