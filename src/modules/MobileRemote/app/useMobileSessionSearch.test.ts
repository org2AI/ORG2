// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MobileRpcClient } from "../connection/mobileRpcClient";
import { createMobileRpcClient } from "../connection/mobileRpcClient";
import { useMobileSessionSearch } from "./useMobileSessionSearch";

function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const row = (id: string) => ({ id, name: id, status: "idle" as const });
const page = (id: string, nextOffset = 1, hasMore = false) => ({
  sessions: [row(id)],
  nextOffset,
  hasMore,
});

describe("useMobileSessionSearch", () => {
  let root: ReturnType<typeof createRoot>;
  let current: ReturnType<typeof useMobileSessionSearch>;
  function Harness({
    client,
    online = true,
  }: {
    client: MobileRpcClient | null;
    online?: boolean;
  }) {
    const value = useMobileSessionSearch(client, online);
    React.useLayoutEffect(() => {
      current = value;
    });
    return null;
  }
  const mount = async (call: ReturnType<typeof vi.fn>, online = true) => {
    const client = { call } as unknown as MobileRpcClient;
    await act(async () =>
      root.render(React.createElement(Harness, { client, online }))
    );
    return client;
  };
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    root = createRoot(document.createElement("div"));
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("releases the real RPC wait on supersession, cancel, offline and unmount", async () => {
    const listeners = new Map<string, (event: { data: string }) => void>();
    const send = vi.fn();
    const socket = {
      readyState: 1,
      send,
      close: vi.fn(),
      addEventListener: (
        name: string,
        listener: (event: { data: string }) => void
      ) => listeners.set(name, listener),
    };
    const client = createMobileRpcClient(socket as unknown as WebSocket, {
      setTimeout: (fn, ms) => window.setTimeout(fn, ms),
      clearTimeout: (id) => window.clearTimeout(id),
    });
    const render = (online = true) =>
      act(async () =>
        root.render(React.createElement(Harness, { client, online }))
      );
    const reply = (id: number, value: string) =>
      listeners.get("message")!({
        data: JSON.stringify({ jsonrpc: "2.0", id, result: page(value) }),
      });
    await render();
    await act(async () => {
      void current.search("old");
    });
    await act(async () => {
      void current.search("new");
    });
    expect(send).toHaveBeenCalledTimes(2); // Old RPC has never replied.
    await act(async () => reply(2, "new"));
    await act(async () => reply(1, "old"));
    expect(current.sessions[0].id).toBe("new");
    await act(async () => {
      void current.search("cancelled");
    });
    await act(async () => current.cancel());
    await act(async () => {
      void current.search("after cancel");
    });
    expect(send).toHaveBeenCalledTimes(4);
    await render(false);
    await render(true);
    await act(async () => {
      void current.search("after reconnect");
    });
    expect(send).toHaveBeenCalledTimes(5);
    await act(async () => root.render(null));
    await act(async () => {
      reply(3, "cancelled");
      reply(4, "offline");
      reply(5, "unmounted");
    });
    expect(socket.close).not.toHaveBeenCalled();
    client.close();
  });

  it("loads bounded server pages past the first 50 using the authoritative cursor", async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce(page("first", 125, true))
      .mockResolvedValueOnce(page("historic", 200));
    await mount(call);
    expect(call).not.toHaveBeenCalled();
    await act(async () => current.search("  project  "));
    expect(call).toHaveBeenNthCalledWith(
      1,
      "session/list",
      {
        query: "project",
        offset: 0,
        limit: 50,
      },
      expect.any(AbortSignal)
    );
    await act(async () => current.loadNext());
    expect(call).toHaveBeenNthCalledWith(
      2,
      "session/list",
      {
        query: "project",
        offset: 125,
        limit: 50,
      },
      expect.any(AbortSignal)
    );
    expect(current.sessions.map((item) => item.id)).toEqual(["historic"]);
    expect(current.phase).toBe("ready");
  });

  it("single-flights repeated submit and exposes the loading transition", async () => {
    const request = deferred();
    const call = vi.fn().mockReturnValue(request.promise);
    await mount(call);
    await act(async () => {
      void current.search("first");
      void current.search("first");
    });
    expect(call).toHaveBeenCalledTimes(1);
    expect(current.phase).toBe("loading");
    await act(async () => request.resolve(page("first")));
    expect(current.phase).toBe("ready");
  });

  it("cancel rejects late responses and queues a fresh query without overlapping RPCs", async () => {
    const old = deferred();
    const call = vi
      .fn()
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(page("new"));
    await mount(call);
    await act(async () => {
      void current.search("old");
    });
    await act(async () => current.cancel());
    expect(current).toMatchObject({ phase: "idle", query: "", sessions: [] });
    await act(async () => {
      void current.search("new");
    });
    expect(call).toHaveBeenCalledTimes(1);
    await act(async () => old.resolve(page("old")));
    expect(current.sessions.map((item) => item.id)).toEqual(["new"]);
    expect(current.query).toBe("new");
  });

  it("switching client clears prior rows and prevents stale desktop results", async () => {
    const old = deferred();
    await mount(vi.fn().mockReturnValue(old.promise));
    await act(async () => {
      void current.search("old");
    });
    const newer = vi.fn().mockResolvedValue(page("desktop-b"));
    await mount(newer);
    expect(current).toMatchObject({ query: "", sessions: [], phase: "idle" });
    await act(async () => current.search("new"));
    await act(async () => old.resolve(page("desktop-a")));
    expect(current.sessions.map((item) => item.id)).toEqual(["desktop-b"]);
  });

  it("failed query can be retried and an empty successful response is ready", async () => {
    const call = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ sessions: [], nextOffset: 0, hasMore: false });
    await mount(call);
    await act(async () => current.search("none"));
    expect(current.phase).toBe("error");
    await act(async () => current.search("none"));
    expect(current).toMatchObject({
      phase: "ready",
      sessions: [],
      hasMore: false,
    });
  });

  it("blocks offline and empty queries without issuing a request", async () => {
    const call = vi.fn();
    const client = await mount(call, false);
    await act(async () => current.search("query"));
    await act(async () =>
      root.render(React.createElement(Harness, { client }))
    );
    await act(async () => current.search("   "));
    expect(call).not.toHaveBeenCalled();
  });

  it("retries the failed history cursor while preserving the last successful page", async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce(page("first", 125, true))
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(page("historic", 200));
    await mount(call);
    await act(async () => current.search("project"));
    await act(async () => current.loadNext());
    expect(current.phase).toBe("error");
    expect(current.sessions.map((item) => item.id)).toEqual(["first"]);
    await act(async () => current.retry());
    expect(call).toHaveBeenNthCalledWith(
      3,
      "session/list",
      {
        query: "project",
        offset: 125,
        limit: 50,
      },
      expect.any(AbortSignal)
    );
    expect(current.sessions.map((item) => item.id)).toEqual(["historic"]);
    expect(current.phase).toBe("ready");
  });

  it("disconnect ends loading immediately and reconnect retries without accepting the old response", async () => {
    const old = deferred();
    const fresh = deferred();
    const call = vi
      .fn()
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(fresh.promise);
    const client = await mount(call);
    await act(async () => {
      void current.search("project");
    });
    await act(async () =>
      root.render(React.createElement(Harness, { client, online: false }))
    );
    expect(current.phase).toBe("error");
    await act(async () => current.retry());
    expect(call).toHaveBeenCalledTimes(1);
    await act(async () =>
      root.render(React.createElement(Harness, { client, online: true }))
    );
    expect(call).toHaveBeenCalledTimes(1); // No automatic scan on reconnect.
    await act(async () => {
      void current.retry();
    });
    await act(async () => old.resolve(page("stale")));
    expect(current.phase).toBe("loading");
    expect(current.sessions).toEqual([]);
    await act(async () => fresh.resolve(page("fresh")));
    expect(current.sessions.map((item) => item.id)).toEqual(["fresh"]);
  });

  it("cancel discards the retry cursor and unrelated new queries start at zero", async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce(page("first", 125, true))
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(page("new"));
    await mount(call);
    await act(async () => current.search("old"));
    await act(async () => current.loadNext());
    await act(async () => current.cancel());
    await act(async () => current.retry());
    expect(call).toHaveBeenCalledTimes(2);
    await act(async () => current.search("new"));
    expect(call).toHaveBeenLastCalledWith(
      "session/list",
      {
        query: "new",
        offset: 0,
        limit: 50,
      },
      expect.any(AbortSignal)
    );
  });

  it("keeps the previous page readable offline without starting background work", async () => {
    const call = vi.fn().mockResolvedValue(page("known", 50, true));
    const client = await mount(call);
    await act(async () => current.search("project"));
    await act(async () =>
      root.render(React.createElement(Harness, { client, online: false }))
    );
    await act(async () => current.loadNext());
    expect(current.sessions.map((item) => item.id)).toEqual(["known"]);
    expect(current.phase).toBe("ready");
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("does not request another page after the cursor is exhausted or exceed the query bound", async () => {
    const call = vi.fn().mockResolvedValue(page("only"));
    await mount(call);
    await act(async () => current.search("x".repeat(201)));
    await act(async () => current.loadNext());
    await act(async () => current.retry());
    expect(call).not.toHaveBeenCalled();
    await act(async () => current.search("literal_100%"));
    await act(async () => current.loadNext());
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith(
      "session/list",
      {
        query: "literal_100%",
        offset: 0,
        limit: 50,
      },
      expect.any(AbortSignal)
    );
  });

  it("retains one bounded result page across repeated next-page requests", async () => {
    const call = vi.fn().mockImplementation((_method, { offset }) =>
      Promise.resolve({
        sessions: Array.from({ length: 50 }, (_, index) =>
          row(`s-${offset + index}`)
        ),
        nextOffset: offset + 50,
        hasMore: offset < 2500,
      })
    );
    await mount(call);
    await act(async () => current.search("project"));
    for (let index = 0; index < 50; index++) {
      await act(async () => current.loadNext());
      expect(current.sessions).toHaveLength(50);
    }
    expect(current.sessions[0].id).toBe("s-2500");
    expect(current.hasMore).toBe(false);
    expect(call).toHaveBeenCalledTimes(51);
  });

  it("unmount invalidates the outstanding request without starting any follow-up work", async () => {
    const request = deferred();
    const call = vi.fn().mockReturnValue(request.promise);
    await mount(call);
    await act(async () => {
      void current.search("project");
    });
    await act(async () => root.render(null));
    await act(async () => request.reject(new Error("late timeout")));
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("rejects a non-advancing cursor instead of repeating the same history page", async () => {
    const call = vi
      .fn()
      .mockResolvedValue({ sessions: [], nextOffset: 0, hasMore: true });
    await mount(call);
    await act(async () => current.search("test"));
    expect(current.phase).toBe("error");
  });

  it.each([
    null,
    {
      sessions: Array.from({ length: 51 }, (_, index) => row(String(index))),
      nextOffset: 51,
      hasMore: false,
    },
    { sessions: [null], nextOffset: 1, hasMore: false },
    {
      sessions: [{ ...row("bad"), updatedAtMs: 1e20 }],
      nextOffset: 1,
      hasMore: false,
    },
    {
      sessions: [{ ...row("bad"), status: ["idle"] }],
      nextOffset: 1,
      hasMore: false,
    },
    { sessions: [row("bad")], nextOffset: 1, hasMore: "false" },
    {
      sessions: Array.from({ length: 51 }, (_, id) => row(String(id))),
      nextOffset: 51,
      hasMore: true,
    },
  ])("rejects malformed search payload at ingestion (%j)", async (payload) => {
    const call = vi.fn().mockResolvedValue(payload);
    await mount(call);
    await act(async () => current.search("query"));
    expect(current).toMatchObject({ phase: "error", sessions: [] });
  });
});
