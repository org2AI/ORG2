// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getChecksLocal, getPRLocal } from "@src/api/tauri/github";
import { readSessionPullRequests } from "@src/api/tauri/session/sessionPullRequests";
import {
  type PullRequestHeadChecks,
  loadPullRequestHeadChecks,
} from "@src/services/git/pullRequestHeadChecks";

import { useSessionPullRequests } from "./useSessionPullRequests";

vi.mock("@src/api/tauri/github", () => ({
  getPRLocal: vi.fn(),
  getChecksLocal: vi.fn(),
}));
vi.mock("@src/api/tauri/session/sessionPullRequests", () => ({
  readSessionPullRequests: vi.fn(),
}));
vi.mock("@src/services/git/pullRequestHeadChecks", () => ({
  loadPullRequestHeadChecks: vi.fn(),
  PULL_REQUEST_HEAD_CHECKS_REUSE_MS: 7500,
}));
const url = (number: number) => `https://github.com/org2ai/org2/pull/${number}`;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { resolve, reject, promise };
}
function metadata(number: number): PullRequestHeadChecks {
  return {
    detail: {
      title: `PR ${number}`,
      state: "open",
      head: { ref: `branch-${number}` },
    },
    headSha: "head",
    checks: { sha: "head", state: "success", check_runs: [], statuses: [] },
    fetchedAt: 1,
  };
}
let latest: ReturnType<typeof useSessionPullRequests>;
function Probe({
  sessionId,
  reloadKey,
}: {
  sessionId: string;
  reloadKey?: string;
}) {
  const result = useSessionPullRequests(sessionId, reloadKey);
  useEffect(() => {
    latest = result;
  }, [result]);
  return createElement(
    "output",
    null,
    result.items.map((item) => item.title).join(",")
  );
}
let root: Root;
let container: HTMLDivElement;
let visibility: DocumentVisibilityState;
const reactEnv = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
beforeEach(() => {
  reactEnv.IS_REACT_ACT_ENVIRONMENT = true;
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.mocked(readSessionPullRequests).mockResolvedValue([url(2152)]);
  vi.mocked(loadPullRequestHeadChecks).mockImplementation(
    async (_repo, number) => metadata(number)
  );
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.resetAllMocks();
  Reflect.deleteProperty(document, "visibilityState");
  Reflect.deleteProperty(reactEnv, "IS_REACT_ACT_ENVIRONMENT");
});
async function render(sessionId = "session", reloadKey?: string) {
  await act(async () => {
    root.render(createElement(Probe, { sessionId, reloadKey }));
  });
}
async function visible(state: DocumentVisibilityState) {
  visibility = state;
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

describe("explicit conversation pull request attachments", () => {
  it("retains two explicitly attached PRs despite differing head branches and canonicalizes duplicates", async () => {
    vi.mocked(readSessionPullRequests).mockResolvedValue([
      url(2152),
      "https://github.com/org2AI/ORG2/pull/2152",
      url(2153),
      "https://example.com/not-a-pr",
    ]);
    await render();
    expect(latest.items.map((item) => [item.url, item.headBranch])).toEqual([
      [url(2152), "branch-2152"],
      [url(2153), "branch-2153"],
    ]);
    expect(loadPullRequestHeadChecks).toHaveBeenCalledTimes(2);
    expect(container.textContent).toBe("PR 2152,PR 2153");
  });
  it("shows the title on first load before checks finish without opening the PR", async () => {
    const pending = deferred<PullRequestHeadChecks>();
    vi.mocked(loadPullRequestHeadChecks).mockImplementation(
      (_repo, number, options) => {
        options?.onDetail?.(metadata(number).detail);
        return pending.promise;
      }
    );
    await render();
    expect(container.textContent).toBe("PR 2152");
    expect(latest.items[0].state).toBe("open");
    expect(latest.items[0].ciStatus).toBe("checking");
    expect(latest.loading).toBe(true);
    await act(async () => pending.reject(new Error("checks offline")));
    expect(container.textContent).toBe("PR 2152");
    expect(latest.items[0].error).toBe(true);
    expect(getPRLocal).not.toHaveBeenCalled();
  });
  it("ignores late partial metadata after the conversation changes", async () => {
    let deliver: ((detail: Record<string, unknown>) => void) | undefined;
    const pending = deferred<PullRequestHeadChecks>();
    vi.mocked(loadPullRequestHeadChecks).mockImplementationOnce(
      (_repo, _number, options) => {
        deliver = options?.onDetail;
        return pending.promise;
      }
    );
    await render("old");
    vi.mocked(readSessionPullRequests).mockResolvedValue([url(2153)]);
    await render("new");
    await act(async () => deliver?.(metadata(2152).detail));
    expect(container.textContent).toBe("PR 2153");
    await act(async () => pending.resolve(metadata(2152)));
    expect(container.textContent).toBe("PR 2153");
  });
  it("retains a loaded title through remount while a real shared-reader refresh is pending", async () => {
    const actual = await vi.importActual<
      typeof import("@src/services/git/pullRequestHeadChecks")
    >("@src/services/git/pullRequestHeadChecks");
    actual.clearPullRequestHeadChecks();
    const oldNow = Date.now;
    let now = oldNow();
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    const pending = deferred<Record<string, unknown>>();
    try {
      vi.mocked(loadPullRequestHeadChecks).mockImplementation(
        actual.loadPullRequestHeadChecks
      );
      vi.mocked(getPRLocal).mockResolvedValue({
        ...metadata(2152).detail,
        head: { sha: "head", ref: "feature" },
      });
      vi.mocked(getChecksLocal).mockRejectedValue(
        new Error("checks unavailable")
      );
      await render();
      expect(container.textContent).toBe("PR 2152");
      expect(latest.items[0].error).toBe(true);
      act(() => root.unmount());
      root = createRoot(container);
      now += 60_000;
      vi.mocked(getPRLocal).mockReturnValue(pending.promise);
      await render();
      expect(container.textContent).toBe("PR 2152");
      expect(latest.loading).toBe(true);
      expect(latest.items[0].metadataLoading).toBe(false);
      await act(async () =>
        pending.resolve({ ...metadata(2152).detail, title: "Updated PR title" })
      );
      expect(container.textContent).toBe("Updated PR title");
    } finally {
      clock.mockRestore();
      actual.clearPullRequestHeadChecks();
    }
  });
  it("defers hidden reads and revalidates once visible", async () => {
    visibility = "hidden";
    await render();
    expect(readSessionPullRequests).not.toHaveBeenCalled();
    await visible("visible");
    expect(readSessionPullRequests).toHaveBeenCalledTimes(1);
    expect(latest.items[0].number).toBe(2152);
  });
  it("rejects old session attachment results after switching conversations", async () => {
    const old = deferred<string[]>();
    vi.mocked(readSessionPullRequests).mockImplementation((sessionId) =>
      sessionId === "old" ? old.promise : Promise.resolve([url(2153)])
    );
    await render("old");
    await render("new");
    await act(async () => {
      old.resolve([url(2152)]);
    });
    expect(latest.items.map((item) => item.number)).toEqual([2153]);
    expect(loadPullRequestHeadChecks).toHaveBeenCalledTimes(1);
  });
  it("limits metadata concurrency to three and stops dequeuing after hidden", async () => {
    const pending = deferred<PullRequestHeadChecks>();
    vi.mocked(readSessionPullRequests).mockResolvedValue(
      [1, 2, 3, 4, 5].map(url)
    );
    vi.mocked(loadPullRequestHeadChecks).mockReturnValue(pending.promise);
    await render();
    expect(loadPullRequestHeadChecks).toHaveBeenCalledTimes(3);
    await visible("hidden");
    await act(async () => {
      pending.resolve(metadata(1));
    });
    expect(loadPullRequestHeadChecks).toHaveBeenCalledTimes(3);
  });
  it("does not start a fallback request after the surface becomes hidden", async () => {
    const pending = deferred<PullRequestHeadChecks>();
    vi.mocked(loadPullRequestHeadChecks).mockReturnValue(pending.promise);
    await render();
    await visible("hidden");
    await act(async () => {
      pending.reject(new Error("checks failed"));
    });
    expect(getPRLocal).not.toHaveBeenCalled();
  });
  it("does not enqueue metadata after the reader unmounts", async () => {
    const pending = deferred<string[]>();
    vi.mocked(readSessionPullRequests).mockReturnValue(pending.promise);
    await render();
    act(() => root.render(null));
    await act(async () => {
      pending.resolve([url(2152)]);
    });
    expect(loadPullRequestHeadChecks).not.toHaveBeenCalled();
  });
  it("preserves an actionable URL when metadata and fallback fail then retries that URL fresh", async () => {
    vi.mocked(loadPullRequestHeadChecks).mockRejectedValueOnce(
      new Error("offline")
    );
    vi.mocked(getPRLocal).mockRejectedValueOnce(new Error("offline"));
    await render();
    expect(latest.items[0]).toMatchObject({
      url: url(2152),
      title: "#2152",
      error: true,
    });
    await act(async () => {
      latest.refresh(url(2152));
    });
    expect(loadPullRequestHeadChecks).toHaveBeenLastCalledWith(
      "org2ai/org2",
      2152,
      expect.objectContaining({ maxAgeMs: 0, onDetail: expect.any(Function) })
    );
    expect(latest.items[0]).toMatchObject({ title: "PR 2152", error: false });
  });
  it("retains successful rows when attachment refresh fails and reloads on the caller key", async () => {
    await render();
    vi.mocked(readSessionPullRequests).mockRejectedValueOnce(
      new Error("read failed")
    );
    await render("session", "updated");
    expect(latest.error).toBe(true);
    expect(latest.items[0].number).toBe(2152);
    await act(async () => {
      latest.refresh();
    });
    expect(latest.error).toBe(false);
  });
});
