import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSubagentRosterResource } from "../subagentRosterResource";
import type { ChildSessionRecord } from "../subagentSessionProjection";

const row = (id = "child", terminal = false): ChildSessionRecord => ({
  sessionId: id,
  name: "Explore (Inspect layout)",
  status: terminal ? "completed" : "running",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  sessionType: "agent",
  parentSessionId: "parent",
  parentEventId: null,
  isTerminal: terminal,
  endedAt: terminal ? new Date().toISOString() : null,
  model: "model",
  totalTokens: 321,
});
function setup(
  load = vi.fn<() => Promise<ChildSessionRecord[]>>().mockResolvedValue([row()])
) {
  let changed = (_id: string) => {};
  let visibilityChanged = () => {};
  const unobserve = vi.fn();
  const visibility = {
    hidden: false,
    addEventListener: vi.fn(
      (_name: string, listener: EventListenerOrEventListenerObject) => {
        visibilityChanged = listener as () => void;
      }
    ),
    removeEventListener: vi.fn(),
  };
  const resource = createSubagentRosterResource(
    load,
    (notify) => {
      changed = notify;
      return unobserve;
    },
    visibility
  );
  return {
    resource,
    load,
    unobserve,
    visibility,
    change: (id = "child") => changed(id),
    hide: (hidden: boolean) => {
      visibility.hidden = hidden;
      visibilityChanged();
    },
  };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("shared child roster resource", () => {
  it("shares a request, coalesces push events ahead of safety refresh, and retains finished children", async () => {
    const s = setup();
    const closeA = s.resource.subscribe(vi.fn());
    const closeB = s.resource.subscribe(vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    expect(s.load).toHaveBeenCalledTimes(1);
    expect(s.resource.getSnapshot().sessions[0]).toMatchObject({
      model: "model",
      totalTokens: 321,
    });
    s.load.mockResolvedValue([row("child", true)]);
    s.change();
    s.change();
    s.change();
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.load).toHaveBeenCalledTimes(2);
    expect(s.resource.getSnapshot().sessions[0].isTerminal).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.load).toHaveBeenCalledTimes(2);
    closeA();
    expect(s.unobserve).not.toHaveBeenCalled();
    closeB();
    expect(s.unobserve).toHaveBeenCalledOnce();
  });

  it("pauses hidden work, ignores unrelated child events, and retains data on error/reopen", async () => {
    const s = setup();
    let close = s.resource.subscribe(vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    s.change("unrelated");
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.load).toHaveBeenCalledTimes(1);
    s.hide(true);
    s.change();
    await vi.advanceTimersByTimeAsync(90_000);
    expect(s.load).toHaveBeenCalledTimes(1);
    s.load.mockRejectedValue(new Error("offline"));
    s.hide(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(s.resource.getSnapshot()).toMatchObject({
      loaded: true,
      error: "Error: offline",
    });
    expect(s.resource.getSnapshot().sessions).toHaveLength(1);
    close();
    const retained = s.resource.getSnapshot().sessions;
    close = s.resource.subscribe(vi.fn());
    expect(s.resource.getSnapshot().sessions).toBe(retained);
    s.load.mockResolvedValue([row("child", true)]);
    await vi.advanceTimersByTimeAsync(0);
    expect(s.resource.getSnapshot().error).toBeNull();
    close();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.resource.getSnapshot().sessions).toEqual([]);
    expect(s.visibility.removeEventListener).toHaveBeenCalled();
  });

  it("rejects late completions after close and isolates another parent resource", async () => {
    let resolve!: (rows: ChildSessionRecord[]) => void;
    const s = setup(
      vi.fn(
        () =>
          new Promise<ChildSessionRecord[]>((done) => {
            resolve = done;
          })
      )
    );
    const close = s.resource.subscribe(vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    close();
    resolve([row()]);
    await vi.advanceTimersByTimeAsync(0);
    expect(s.resource.getSnapshot().loaded).toBe(false);
    const other = setup(vi.fn().mockResolvedValue([row("other", true)]));
    const closeOther = other.resource.subscribe(vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    expect(other.resource.getSnapshot().sessions[0].sessionId).toBe("other");
    expect(s.resource.getSnapshot().sessions).toEqual([]);
    closeOther();
  });

  it("keeps requests single-flight and refreshes once after an in-flight invalidation", async () => {
    let resolve!: (rows: ChildSessionRecord[]) => void;
    const s = setup(
      vi.fn(
        () =>
          new Promise<ChildSessionRecord[]>((done) => {
            resolve = done;
          })
      )
    );
    const close = s.resource.subscribe(vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    s.change("");
    s.change("");
    await vi.advanceTimersByTimeAsync(31_000);
    expect(s.load).toHaveBeenCalledTimes(1);
    resolve([row()]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.load).toHaveBeenCalledTimes(2);
    close();
  });
});

it("does not overlap IPC requests when reopened before a retired request settles", async () => {
  let resolve!: (rows: ChildSessionRecord[]) => void;
  const s = setup(
    vi.fn(
      () =>
        new Promise<ChildSessionRecord[]>((done) => {
          resolve = done;
        })
    )
  );
  const first = s.resource.subscribe(vi.fn());
  await vi.advanceTimersByTimeAsync(0);
  first();
  const second = s.resource.subscribe(vi.fn());
  await vi.advanceTimersByTimeAsync(0);
  expect(s.load).toHaveBeenCalledTimes(1);
  resolve([row("retired")]);
  await vi.advanceTimersByTimeAsync(0);
  expect(s.resource.getSnapshot().sessions).toEqual([]);
  expect(s.load).toHaveBeenCalledTimes(2);
  second();
});
