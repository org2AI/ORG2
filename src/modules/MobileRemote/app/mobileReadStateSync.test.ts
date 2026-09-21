import { describe, expect, it, vi } from "vitest";

import type {
  MobileRpcClient,
  RpcNotificationHandler,
} from "../connection/mobileRpcClient";
import { createMobileReadStateSync } from "./mobileReadStateSync";

async function flush() {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function transport() {
  const visited = new Set<string>();
  const handlers = new Set<RpcNotificationHandler>();
  const call = vi.fn(
    async (method: string, params?: Record<string, unknown>) => {
      const ids = params?.sessionIds as string[];
      if (method === "session/mark_visited")
        ids.forEach((id) => visited.add(id));
      return { visitedIds: ids.filter((id) => visited.has(id)) };
    }
  );
  const client = {
    call,
    onNotification: (fn: RpcNotificationHandler) => {
      handlers.add(fn);
      return () => {
        handlers.delete(fn);
      };
    },
    notify: vi.fn(),
    close: vi.fn(),
    readyState: 1,
  } as MobileRpcClient;
  return {
    client,
    call,
    visited,
    handlers,
    changed: () =>
      handlers.forEach((fn) => fn("session/read_state_changed", {})),
  };
}

describe("mobile read-state lifecycle", () => {
  it("queries only watched IDs and reacts to Desktop push without fetching transcripts or the roster", async () => {
    const rpc = transport();
    const sync = createMobileReadStateSync();
    sync.watch(["a", "b"]);
    sync.connect(rpc.client, "account/desktop");
    await flush();
    expect([...sync.getSnapshot()]).toEqual([
      ["a", false],
      ["b", false],
    ]);
    rpc.visited.add("a");
    rpc.changed();
    await flush();
    expect(sync.getSnapshot().get("a")).toBe(true);
    expect(
      rpc.call.mock.calls.every(([method]) => method === "session/read_state")
    ).toBe(true);
    const count = rpc.call.mock.calls.length;
    await flush();
    await flush();
    expect(rpc.call).toHaveBeenCalledTimes(count);
    sync.dispose();
    expect(rpc.handlers.size).toBe(0);
  });
  it("coalesces a burst into at most one trailing query and rejects stale projections", async () => {
    const rpc = transport();
    const first = deferred<{ visitedIds: string[] }>();
    rpc.call.mockImplementationOnce(() => first.promise);
    const sync = createMobileReadStateSync();
    sync.watch(["a"]);
    sync.connect(rpc.client, "desktop");
    await flush();
    rpc.visited.add("a");
    for (let i = 0; i < 100; i++) rpc.changed();
    expect(rpc.call).toHaveBeenCalledTimes(1);
    first.resolve({ visitedIds: [] });
    await flush();
    expect(rpc.call).toHaveBeenCalledTimes(2);
    expect(sync.getSnapshot().get("a")).toBe(true);
    sync.dispose();
  });
  it("retains uncertain receipts on the same desktop but drops them when switching accounts/desktops", async () => {
    const a = transport(),
      b = transport();
    const lost = deferred<{ visitedIds: string[] }>();
    a.call.mockImplementationOnce(() => lost.promise);
    const sync = createMobileReadStateSync();
    sync.connect(a.client, "a");
    sync.markVisited("s");
    await flush();
    sync.connect(null, "a");
    sync.connect(b.client, "a");
    await flush();
    expect(b.visited.has("s")).toBe(true);
    lost.resolve({ visitedIds: ["s"] });
    await flush();
    sync.connect(null, "a");
    sync.markVisited("never-send-to-b");
    sync.connect(a.client, "b");
    await flush();
    expect(a.visited.has("never-send-to-b")).toBe(false);
    sync.dispose();
  });
  it("never treats a missing mark acknowledgment as success and retries only on an external trigger", async () => {
    const rpc = transport();
    rpc.call.mockResolvedValueOnce({ visitedIds: [] });
    const sync = createMobileReadStateSync();
    sync.connect(rpc.client, "a");
    sync.markVisited("s");
    await flush();
    expect(rpc.call).toHaveBeenCalledTimes(1);
    expect(sync.getSnapshot().size).toBe(0);
    await flush();
    expect(rpc.call).toHaveBeenCalledTimes(1);
    sync.refresh();
    await flush();
    expect(rpc.visited.has("s")).toBe(true);
    sync.dispose();
  });
  it("discards old replies after scope switches, hidden transport, and disposal", async () => {
    const rpc = transport();
    const first = deferred<{ visitedIds: string[] }>();
    rpc.call.mockImplementationOnce(() => first.promise);
    const sync = createMobileReadStateSync();
    sync.watch(["a"]);
    sync.connect(rpc.client, "old");
    await flush();
    sync.connect(null, "old");
    first.resolve({ visitedIds: ["a"] });
    await flush();
    expect(sync.getSnapshot().size).toBe(0);
    expect(rpc.handlers.size).toBe(0);
    sync.dispose();
  });
  it("bounds both watched IDs and each wire batch; same watch is a no-op", async () => {
    const rpc = transport();
    const sync = createMobileReadStateSync();
    const ids = Array.from({ length: 1300 }, (_, i) => `s-${i}`);
    sync.watch(ids);
    sync.connect(rpc.client, "a");
    await flush();
    expect(sync.getSnapshot().size).toBe(1200);
    expect(rpc.call).toHaveBeenCalledTimes(6);
    expect(
      rpc.call.mock.calls.every(
        ([, params]) => (params?.sessionIds as string[]).length <= 200
      )
    ).toBe(true);
    sync.watch(ids);
    await flush();
    expect(rpc.call).toHaveBeenCalledTimes(6);
    sync.watch([]);
    await flush();
    expect(sync.getSnapshot().size).toBe(0);
    rpc.changed();
    await flush();
    expect(rpc.call).toHaveBeenCalledTimes(6);
    sync.dispose();
  });
  it("rejects foreign IDs in a reply instead of accepting them into the projection", async () => {
    const rpc = transport();
    rpc.call.mockResolvedValueOnce({ visitedIds: ["foreign"] });
    const sync = createMobileReadStateSync();
    sync.watch(["a"]);
    sync.connect(rpc.client, "a");
    await flush();
    expect(sync.getSnapshot().size).toBe(0);
    sync.dispose();
  });
});
