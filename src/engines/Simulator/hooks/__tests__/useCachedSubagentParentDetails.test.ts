// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { useCachedSubagentParentDetails } from "../useCachedSubagentParentDetails";

const proxy = vi.hoisted(() => ({
  getLatestSessionSnapshot: vi.fn(),
  subscribeSession: vi.fn(),
  getSnapshot: vi.fn(),
  loadFromCache: vi.fn(),
}));
vi.mock("@src/engines/SessionCore/core/store/EventStoreProxy", () => ({
  eventStoreProxy: proxy,
}));

it("reads cached parent events only, switches scope, pauses hidden, and disposes", async () => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  let hidden = false;
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden,
  });
  const listeners = new Map<string, () => void>();
  const snapshots = new Map<string, unknown>();
  const snapshot = (summary: string) => ({
    chatEvents: [
      {
        actionType: "tool_call",
        functionName: "subagent",
        args: { subagentSessionId: "child", description: "Task" },
        result: { summary },
      },
    ],
  });
  snapshots.set("a", snapshot("Initial"));
  proxy.getLatestSessionSnapshot.mockImplementation(
    (id) => snapshots.get(id) ?? null
  );
  proxy.subscribeSession.mockImplementation((id, callback) => {
    listeners.set(id, callback);
    return () => listeners.delete(id);
  });
  let value: ReturnType<typeof useCachedSubagentParentDetails> = new Map();
  function Harness({ id }: { id: string }) {
    const next = useCachedSubagentParentDetails(id);
    useEffect(() => {
      value = next;
    }, [next]);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(Harness, { id: "a" })));
    expect(value.get("child")?.summary).toBe("Initial");
    await act(async () => {
      hidden = true;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(listeners.size).toBe(0);
    snapshots.set("a", snapshot("Updated while hidden"));
    await act(async () => {
      hidden = false;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(value.get("child")?.summary).toBe("Updated while hidden");
    await act(async () => root.render(createElement(Harness, { id: "b" })));
    expect(value.size).toBe(0);
    expect([...listeners.keys()]).toEqual(["b"]);
    expect(proxy.getSnapshot).not.toHaveBeenCalled();
    expect(proxy.loadFromCache).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
  }
  expect(listeners.size).toBe(0);
});
