/* @vitest-environment jsdom */
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CoreSessionSummary } from "@src/api/tauri/lineage";
import { createHookLifecycleHarness } from "@src/test/hookLifecycleHarness";

import { useChatViewOrgtrackSummary } from "./useChatViewOrgtrackSummary";

const mocks = vi.hoisted(() => ({
  getOrgtrackSessionSummary: vi.fn(),
}));

vi.mock("@src/api/tauri/lineage", () => ({
  getOrgtrackSessionSummary: mocks.getOrgtrackSessionSummary,
}));
vi.mock("@src/hooks/logger", () => ({
  createLogger: () => ({ warn: vi.fn() }),
}));

function summary(sessionId: string, filesChanged: number): CoreSessionSummary {
  return {
    sessionId,
    title: sessionId,
    source: "claude_code",
    filesChanged,
    linesAdded: filesChanged,
    linesRemoved: 0,
    relatedCommits: 0,
    committedRatePercent: 0,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushAsync(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function createHarness() {
  return createHookLifecycleHarness(
    (props: { sessionId: string; reloadKey?: string }) =>
      useChatViewOrgtrackSummary(props.sessionId, props.reloadKey)
  );
}

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
  vi.clearAllMocks();
});

describe("useChatViewOrgtrackSummary", () => {
  it("never shows the previous session's summary after a switch", async () => {
    const first = summary("session-a", 5);
    mocks.getOrgtrackSessionSummary.mockResolvedValueOnce(first);
    mocks.getOrgtrackSessionSummary.mockResolvedValueOnce(first);
    const harness = createHarness();
    cleanup.push(harness.unmount);

    await harness.render({ sessionId: "session-a" });
    await flushAsync();
    expect(harness.read()).toBe(first);

    const next = deferred<CoreSessionSummary>();
    mocks.getOrgtrackSessionSummary.mockReturnValue(next.promise);
    await harness.render({ sessionId: "session-b" });
    await flushAsync();
    expect(harness.read()).toBeNull();

    const second = summary("session-b", 2);
    next.resolve(second);
    await flushAsync();
    expect(harness.read()).toBe(second);
  });

  it("re-reads on reloadKey and keeps the last summary until it lands", async () => {
    const first = summary("session-a", 1);
    mocks.getOrgtrackSessionSummary.mockResolvedValue(first);
    const harness = createHarness();
    cleanup.push(harness.unmount);

    await harness.render({ sessionId: "session-a", reloadKey: "round-1" });
    await flushAsync();
    expect(harness.read()).toBe(first);

    const reread = deferred<CoreSessionSummary>();
    mocks.getOrgtrackSessionSummary.mockReturnValue(reread.promise);
    const callsBefore = mocks.getOrgtrackSessionSummary.mock.calls.length;
    await harness.render({ sessionId: "session-a", reloadKey: "round-2" });
    await flushAsync();
    expect(mocks.getOrgtrackSessionSummary.mock.calls.length).toBeGreaterThan(
      callsBefore
    );
    expect(harness.read()).toBe(first);

    const updated = summary("session-a", 3);
    reread.resolve(updated);
    await flushAsync();
    expect(harness.read()).toBe(updated);
  });

  it("keeps the last good summary when a re-read fails", async () => {
    const first = summary("session-a", 4);
    mocks.getOrgtrackSessionSummary.mockResolvedValue(first);
    const harness = createHarness();
    cleanup.push(harness.unmount);

    await harness.render({ sessionId: "session-a", reloadKey: "1" });
    await flushAsync();

    mocks.getOrgtrackSessionSummary.mockRejectedValue(new Error("busy"));
    await harness.render({ sessionId: "session-a", reloadKey: "2" });
    await flushAsync();
    expect(harness.read()).toBe(first);
  });
});
