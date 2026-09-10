/* @vitest-environment jsdom */
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { OrgtrackFileTimeline } from "@src/api/tauri/lineage";
import { createHookLifecycleHarness } from "@src/test/hookLifecycleHarness";

import {
  type UseOrgtrackFileTimelineOptions,
  useOrgtrackFileTimeline,
} from "./useOrgtrackFileTimeline";

const mocks = vi.hoisted(() => ({
  getOrgtrackFileTimeline: vi.fn(),
}));

vi.mock("@src/api/tauri/lineage", () => ({
  getOrgtrackFileTimeline: mocks.getOrgtrackFileTimeline,
}));

const TIMELINE = { entries: [] } as unknown as OrgtrackFileTimeline;

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
  return createHookLifecycleHarness((props: UseOrgtrackFileTimelineOptions) =>
    useOrgtrackFileTimeline(props)
  );
}

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
  vi.clearAllMocks();
});

describe("useOrgtrackFileTimeline", () => {
  it("loads the timeline for the given repo and file", async () => {
    const request = deferred<OrgtrackFileTimeline>();
    mocks.getOrgtrackFileTimeline.mockReturnValue(request.promise);
    const harness = createHarness();
    cleanup.push(harness.unmount);

    await harness.render({ repoPath: "/repo", filePath: "src/a.ts" });
    expect(harness.read()).toMatchObject({
      timeline: null,
      loading: true,
      error: null,
    });

    request.resolve(TIMELINE);
    await flushAsync();
    expect(mocks.getOrgtrackFileTimeline).toHaveBeenCalledWith({
      repoPath: "/repo",
      filePath: "src/a.ts",
    });
    expect(harness.read()).toMatchObject({
      timeline: TIMELINE,
      loading: false,
      error: null,
    });
  });

  it("does not fetch and reports idle state without a file or repo path", async () => {
    const harness = createHarness();
    cleanup.push(harness.unmount);

    await harness.render({ repoPath: "/repo", filePath: null });
    await flushAsync();
    expect(mocks.getOrgtrackFileTimeline).not.toHaveBeenCalled();
    expect(harness.read()).toMatchObject({
      timeline: null,
      loading: false,
      error: null,
    });

    await harness.render({ repoPath: "", filePath: "src/a.ts" });
    await flushAsync();
    expect(mocks.getOrgtrackFileTimeline).not.toHaveBeenCalled();
    expect(harness.read()).toMatchObject({ timeline: null, loading: false });
  });

  it("does not fetch when autoLoad is false", async () => {
    const harness = createHarness();
    cleanup.push(harness.unmount);

    await harness.render({
      repoPath: "/repo",
      filePath: "src/a.ts",
      autoLoad: false,
    });
    await flushAsync();
    expect(mocks.getOrgtrackFileTimeline).not.toHaveBeenCalled();
    expect(harness.read()).toMatchObject({ timeline: null, loading: false });
  });

  it("maps a rejected query to an error message and clears the timeline", async () => {
    mocks.getOrgtrackFileTimeline.mockRejectedValue(new Error("boom"));
    const harness = createHarness();
    cleanup.push(harness.unmount);

    await harness.render({ repoPath: "/repo", filePath: "src/a.ts" });
    await flushAsync();
    expect(harness.read()).toMatchObject({
      timeline: null,
      loading: false,
      error: "boom",
    });

    mocks.getOrgtrackFileTimeline.mockRejectedValue("plain failure");
    await act(async () => harness.read().refresh());
    await flushAsync();
    expect(harness.read()).toMatchObject({ error: "plain failure" });
  });

  it("refreshes the same key and refetches when the file changes", async () => {
    const first = { entries: [{ id: 1 }] } as unknown as OrgtrackFileTimeline;
    const second = { entries: [{ id: 2 }] } as unknown as OrgtrackFileTimeline;
    mocks.getOrgtrackFileTimeline.mockResolvedValue(first);
    const harness = createHarness();
    cleanup.push(harness.unmount);

    await harness.render({ repoPath: "/repo", filePath: "src/a.ts" });
    await flushAsync();
    expect(harness.read().timeline).toBe(first);

    const callsBeforeRefresh = mocks.getOrgtrackFileTimeline.mock.calls.length;
    const request = deferred<OrgtrackFileTimeline>();
    mocks.getOrgtrackFileTimeline.mockReturnValue(request.promise);
    await act(async () => harness.read().refresh());
    expect(harness.read()).toMatchObject({
      timeline: null,
      loading: true,
      error: null,
    });
    request.resolve(second);
    await flushAsync();
    expect(mocks.getOrgtrackFileTimeline.mock.calls.length).toBe(
      callsBeforeRefresh + 1
    );
    expect(harness.read()).toMatchObject({ timeline: second, loading: false });

    mocks.getOrgtrackFileTimeline.mockResolvedValue(first);
    await harness.render({ repoPath: "/repo", filePath: "src/b.ts" });
    await flushAsync();
    expect(mocks.getOrgtrackFileTimeline).toHaveBeenLastCalledWith({
      repoPath: "/repo",
      filePath: "src/b.ts",
    });
  });
});
