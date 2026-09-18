// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import React, { act, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { removeSession } from "@src/store/session/sessionAtom/mutations";
import {
  MAX_CELL_REPLAY_STATES,
  cellReplayKey,
  cellReplayStatesAtom,
  clearCellReplaySessionAtom,
} from "@src/store/ui/simulatorAtom";
import {
  createInstrumentedStore,
  getInstrumentedStore,
  resetInstrumentedStore,
} from "@src/util/core/state/instrumentedStore";

import { useCellReplayState } from "../useCellReplayState";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function events(sessionId: string, count = 5): SessionEvent[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${sessionId}-event-${i}`,
    sessionId,
    chunk_id: null,
    createdAt: new Date(1700000000000 + i * 1000).toISOString(),
    actionType: "tool_call",
    functionName: "read_file",
    uiCanonical: "",
    args: {},
    result: {},
    source: "assistant",
    displayText: "",
    displayStatus: "completed",
    displayVariant: "tool_call",
    activityStatus: "agent",
  }));
}
function mount(
  store: ReturnType<typeof createStore>,
  sessionId: string,
  thread = "review"
) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const result = {
    current: null as ReturnType<typeof useCellReplayState> | null,
  };
  let source = events(sessionId);
  let externalCursorMs: number | null = null;
  function Harness() {
    const state = useCellReplayState({
      events: source,
      cellId: cellReplayKey(sessionId, thread),
      autoPlayInterval: 100,
      externalCursorMs,
    });
    useLayoutEffect(() => {
      result.current = state;
    });
    return null;
  }
  const render = () =>
    act(() =>
      root.render(
        React.createElement(
          Provider,
          { store },
          React.createElement(
            React.StrictMode,
            null,
            React.createElement(Harness)
          )
        )
      )
    );
  render();
  let live = true;
  const unmount = () => {
    if (!live) return;
    live = false;
    act(() => root.unmount());
    container.remove();
  };
  cleanups.push(unmount);
  return {
    result,
    unmount,
    rerender(next: SessionEvent[], cursor: number | null = null) {
      source = next;
      externalCursorMs = cursor;
      render();
    },
  };
}
it.each([
  { action: "goToEnd", initial: 1, expected: 4 },
  { action: "reset", initial: 3, expected: 0 },
  { action: "play", initial: 4, expected: 0 },
] as const)(
  "$action commits the same cursor and playing state that remount restores",
  async ({ action, initial, expected }) => {
    const store = createStore();
    const key = cellReplayKey("a", "review");
    store.set(cellReplayStatesAtom, {
      [key]: { currentIndex: initial, isPlaying: false, hasUserOverride: true },
    });
    const first = mount(store, "a");
    await act(async () => first.result.current!.controls[action]());
    expect(first.result.current!.state.currentIndex).toBe(expected);
    expect(store.get(cellReplayStatesAtom)[key]).toMatchObject({
      currentIndex: expected,
      isPlaying: action === "play",
    });
    first.unmount();
    const reopened = mount(store, "a");
    expect(reopened.result.current!.state.currentIndex).toBe(expected);
    expect(reopened.result.current!.state.isPlaying).toBe(action === "play");
  }
);
it("keeps same-name threads isolated and restores each session's own override", async () => {
  const store = createStore();
  const first = mount(store, "a");
  await act(async () => first.result.current!.controls.goToIndex(1));
  first.unmount();
  const second = mount(store, "b");
  expect(second.result.current!.state.mode).toBe("follow");
  expect(second.result.current!.state.currentIndex).toBe(4);
  second.unmount();
  const firstAgain = mount(store, "a");
  expect(firstAgain.result.current!.state.mode).toBe("detached");
  expect(firstAgain.result.current!.state.currentIndex).toBe(1);
});
it("pauses hidden playback, resumes without catch-up and releases the timer on unmount", async () => {
  vi.useFakeTimers();
  const visibility = vi
    .spyOn(document, "visibilityState", "get")
    .mockReturnValue("visible");
  const store = createStore();
  const instance = mount(store, "a");
  await act(async () => instance.result.current!.controls.play());
  expect(vi.getTimerCount()).toBe(1);
  visibility.mockReturnValue("hidden");
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(vi.getTimerCount()).toBe(0);
  await act(async () => {
    vi.advanceTimersByTime(10_000);
  });
  expect(instance.result.current!.state.currentIndex).toBe(0);
  expect(instance.result.current!.state.isPlaying).toBe(true);
  visibility.mockReturnValue("visible");
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(vi.getTimerCount()).toBe(1);
  await act(async () => {
    vi.advanceTimersByTime(100);
  });
  expect(instance.result.current!.state.currentIndex).toBe(1);
  instance.unmount();
  expect(vi.getTimerCount()).toBe(0);
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(vi.getTimerCount()).toBe(0);
});
it("bounds visited-cell retention and drops only the deleted session", async () => {
  const store = createStore();
  for (let index = 0; index < MAX_CELL_REPLAY_STATES + 5; index++) {
    const instance = mount(store, `session-${index}`);
    await act(async () => instance.result.current!.controls.goToIndex(1));
    instance.unmount();
  }
  expect(Object.keys(store.get(cellReplayStatesAtom))).toHaveLength(
    MAX_CELL_REPLAY_STATES
  );
  expect(
    store.get(cellReplayStatesAtom)[cellReplayKey("session-0", "review")]
  ).toBeUndefined();
  const recent = `session-${MAX_CELL_REPLAY_STATES + 4}`;
  store.set(clearCellReplaySessionAtom, recent);
  expect(
    store.get(cellReplayStatesAtom)[cellReplayKey(recent, "review")]
  ).toBeUndefined();
  expect(
    store.get(cellReplayStatesAtom)[cellReplayKey("session-6", "review")]
  ).toMatchObject({ currentIndex: 1 });
});

it("stops user-started playback cleanly at the end in StrictMode", async () => {
  vi.useFakeTimers();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const store = createStore();
  const instance = mount(store, "ended");
  await act(async () => instance.result.current!.controls.play());
  expect(instance.result.current!.state.currentIndex).toBe(0);
  expect(instance.result.current!.state.isPlaying).toBe(true);
  expect(vi.getTimerCount()).toBe(1);
  await act(async () => {
    vi.advanceTimersByTime(500);
  });
  expect(instance.result.current!.state.currentIndex).toBe(4);
  expect(instance.result.current!.state.isPlaying).toBe(false);
  expect(
    store.get(cellReplayStatesAtom)[cellReplayKey("ended", "review")]
  ).toMatchObject({ currentIndex: 4, isPlaying: false });
  expect(vi.getTimerCount()).toBe(0);
});

it("does not publish a queued follow update after unmount", async () => {
  const store = createStore();
  const instance = mount(store, "closed");
  instance.rerender(events("closed", 6));
  instance.unmount();
  await act(async () => {
    await Promise.resolve();
  });
  expect(
    store.get(cellReplayStatesAtom)[cellReplayKey("closed", "review")]
  ).toBeUndefined();
});

it("preserves follow, detach and resync transitions while the event stream grows", async () => {
  const store = createStore();
  const instance = mount(store, "stream");
  await act(async () => {
    instance.rerender(events("stream", 6));
  });
  expect(instance.result.current!.state.currentIndex).toBe(5);
  await act(async () => {
    instance.result.current!.controls.goToIndex(1);
  });
  await act(async () => {
    instance.rerender(events("stream", 7));
  });
  expect(instance.result.current!.state.mode).toBe("detached");
  expect(instance.result.current!.state.currentIndex).toBe(1);
  await act(async () => {
    instance.result.current!.controls.syncToMain();
  });
  expect(instance.result.current!.state.mode).toBe("follow");
  expect(instance.result.current!.state.currentIndex).toBe(6);
  expect(
    store.get(cellReplayStatesAtom)[cellReplayKey("stream", "review")]
  ).toMatchObject({ currentIndex: 6, hasUserOverride: false });
  await act(async () => {
    instance.rerender(events("stream", 7), 1700000002000);
  });
  expect(instance.result.current!.state.mode).toBe("synced");
  expect(instance.result.current!.state.currentIndex).toBe(2);
  await act(async () => {
    instance.rerender(events("stream", 7));
  });
  expect(instance.result.current!.state.currentIndex).toBe(6);
});

it("retention must not reset an actively mounted detached owner", async () => {
  const store = createStore();
  const instance = mount(store, "active");
  await act(async () => instance.result.current!.controls.goToIndex(1));
  await act(async () => {
    for (let i = 0; i < MAX_CELL_REPLAY_STATES; i++) {
      store.set(cellReplayStatesAtom, (previous) => ({
        ...previous,
        [cellReplayKey(`other-${i}`, "review")]: {
          currentIndex: 1,
          isPlaying: false,
          hasUserOverride: true,
        },
      }));
    }
  });
  expect(instance.result.current!.state.mode).toBe("detached");
  expect(instance.result.current!.state.currentIndex).toBe(1);
  expect(Object.keys(store.get(cellReplayStatesAtom))).toHaveLength(
    MAX_CELL_REPLAY_STATES + 1
  );
  instance.unmount();
  expect(Object.keys(store.get(cellReplayStatesAtom))).toHaveLength(
    MAX_CELL_REPLAY_STATES
  );
});

it("deletion must not be undone by a still-mounted cell", async () => {
  const store = createStore();
  const instance = mount(store, "deleted");
  await act(async () => instance.result.current!.controls.goToIndex(1));
  await act(async () => store.set(clearCellReplaySessionAtom, "deleted"));
  expect(
    store.get(cellReplayStatesAtom)[cellReplayKey("deleted", "review")]
  ).toBeUndefined();
});

it("session removal revokes mounted playback and later user writes only in its store", async () => {
  vi.useFakeTimers();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  resetInstrumentedStore();
  createInstrumentedStore();
  const store = getInstrumentedStore();
  const instance = mount(store, "deleted-playing");
  const otherStore = createStore();
  const other = mount(otherStore, "deleted-playing");
  await act(async () => {
    instance.result.current!.controls.play();
    other.result.current!.controls.play();
  });
  expect(vi.getTimerCount()).toBe(2);
  await act(async () => removeSession("deleted-playing"));
  expect(instance.result.current!.state.isPlaying).toBe(false);
  expect(vi.getTimerCount()).toBe(1);
  await act(async () => {
    instance.result.current!.controls.play();
    vi.advanceTimersByTime(100);
  });
  expect(
    store.get(cellReplayStatesAtom)[cellReplayKey("deleted-playing", "review")]
  ).toBeUndefined();
  expect(other.result.current!.state.currentIndex).toBe(1);
  expect(instance.result.current!.state.isPlaying).toBe(false);
  instance.unmount();
  other.unmount();
  expect(vi.getTimerCount()).toBe(0);
  resetInstrumentedStore();
});

it("revokes a queued follow update before its microtask runs", async () => {
  const store = createStore();
  const instance = mount(store, "queued-delete");
  instance.rerender(events("queued-delete", 6));
  act(() => store.set(clearCellReplaySessionAtom, "queued-delete"));
  await act(async () => {
    await Promise.resolve();
  });
  expect(
    store.get(cellReplayStatesAtom)[cellReplayKey("queued-delete", "review")]
  ).toBeUndefined();
});

it("does not republish replay state when an owner unmounts under the retention cap", async () => {
  const store = createStore();
  const instance = mount(store, "quiet");
  await act(async () => instance.result.current!.controls.goToIndex(1));
  const retained = store.get(cellReplayStatesAtom);
  instance.unmount();
  expect(store.get(cellReplayStatesAtom)).toBe(retained);
  expect(retained[cellReplayKey("quiet", "review")]).toMatchObject({
    currentIndex: 1,
  });
});
