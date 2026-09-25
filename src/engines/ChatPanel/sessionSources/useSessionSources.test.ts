// @vitest-environment jsdom
import React, { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionSource } from "./extractSessionSources";
import { useSessionSourcesState } from "./useSessionSources";

const api = vi.hoisted(() => ({ readSessionSourceMessages: vi.fn() }));

vi.mock("@src/api/tauri/session/sessionSources", () => api);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useSessionSources", () => {
  let root: Root;
  let container: HTMLDivElement;
  const captured: {
    current: SessionSource[];
    state: ReturnType<typeof useSessionSourcesState> | null;
  } = { current: [], state: null };

  function Probe({
    sessionId,
    reloadKey,
  }: {
    sessionId: string | null;
    reloadKey?: string;
  }) {
    const state = useSessionSourcesState(sessionId, reloadKey);
    useEffect(() => {
      captured.current = state.sources;
      captured.state = state;
    });
    return null;
  }

  function render(sessionId: string | null, reloadKey?: string) {
    act(() => {
      root.render(React.createElement(Probe, { sessionId, reloadKey }));
    });
  }

  beforeEach(() => {
    Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
    api.readSessionSourceMessages.mockReset();
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    container = document.createElement("div");
    root = createRoot(container);
    captured.current = [];
  });

  afterEach(() => {
    act(() => root.unmount());
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    Reflect.deleteProperty(document, "hidden");
  });

  it("never shows one session's sources for another", async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    api.readSessionSourceMessages
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    render("session-a");
    await act(async () => {
      first.resolve([{ id: "a1", text: "https://a.dev/one" }]);
    });
    expect(captured.current.map((source) => source.key)).toEqual([
      "link:https://a.dev/one",
    ]);

    render("session-b");
    expect(captured.current).toEqual([]);
    await act(async () => {
      second.resolve([{ id: "b1", text: "", images: ["/tmp/b.png"] }]);
    });
    expect(captured.current.map((source) => source.key)).toEqual([
      "image:/tmp/b.png",
    ]);
  });

  it("ignores a read that finishes after the session changed", async () => {
    const stale = deferred<unknown>();
    api.readSessionSourceMessages
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce([]);

    render("session-a");
    render("session-b");
    await act(async () => {
      stale.resolve([{ id: "a1", text: "https://a.dev/late" }]);
    });
    expect(captured.current).toEqual([]);
  });

  it("keeps the last list when a re-read fails, and the same list when nothing changed", async () => {
    api.readSessionSourceMessages.mockResolvedValueOnce([
      { id: "a1", text: "https://a.dev/one" },
    ]);
    render("session-a", "t1");
    await act(async () => {});
    const firstList = captured.current;
    expect(firstList).toHaveLength(1);

    api.readSessionSourceMessages.mockResolvedValueOnce([
      { id: "a1", text: "https://a.dev/one" },
    ]);
    render("session-a", "t2");
    await act(async () => {});
    expect(captured.current).toBe(firstList);

    api.readSessionSourceMessages.mockRejectedValueOnce(new Error("busy"));
    render("session-a", "t3");
    await act(async () => {});
    expect(captured.current).toBe(firstList);
    expect(api.readSessionSourceMessages).toHaveBeenCalledTimes(3);
  });

  it("shares concurrent equivalent reads and releases the registry after unmount", async () => {
    const first = deferred<never[]>();
    api.readSessionSourceMessages
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce([]);
    act(() =>
      root.render(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(Probe, {
            sessionId: "session-a",
            reloadKey: "v1",
          }),
          React.createElement(Probe, {
            sessionId: "session-a",
            reloadKey: "v1",
          })
        )
      )
    );
    expect(api.readSessionSourceMessages).toHaveBeenCalledTimes(1);
    act(() => root.render(null));
    render("session-a", "v1");
    await act(async () => {});
    expect(api.readSessionSourceMessages).toHaveBeenCalledTimes(2);
    await act(async () => first.resolve([]));
  });

  it("starts a fresh read for invalidation while the old read is pending", async () => {
    const old = deferred<unknown>();
    const fresh = deferred<unknown>();
    api.readSessionSourceMessages
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(fresh.promise);
    render("session-a", "v1");
    render("session-a", "v2");
    expect(api.readSessionSourceMessages).toHaveBeenCalledTimes(2);
    await act(async () =>
      fresh.resolve([{ id: "new", text: "https://new.dev/" }])
    );
    await act(async () =>
      old.resolve([{ id: "old", text: "https://old.dev/" }])
    );
    expect(captured.current[0]).toMatchObject({ messageId: "new" });
  });

  it("exposes loading and errors, retries, and updates a fragment URL with the same key", async () => {
    const first = deferred<unknown>();
    api.readSessionSourceMessages.mockReturnValueOnce(first.promise);
    render("session-a");
    expect(captured.state).toMatchObject({ loading: true, error: false });
    await act(async () => first.reject(new Error("offline")));
    expect(captured.state).toMatchObject({ loading: false, error: true });
    api.readSessionSourceMessages.mockResolvedValueOnce([
      { id: "one", text: "https://a.dev/doc#first" },
    ]);
    await act(async () => captured.state?.retry());
    expect(captured.state).toMatchObject({ loading: false, error: false });
    const firstList = captured.current;
    api.readSessionSourceMessages.mockResolvedValueOnce([
      { id: "one", text: "https://a.dev/doc#second" },
    ]);
    await act(async () => captured.state?.retry());
    expect(captured.current).not.toBe(firstList);
    expect(captured.current[0]).toMatchObject({
      url: "https://a.dev/doc#second",
    });
  });

  it("refreshes provenance and document titles when the resource identity stays unchanged", async () => {
    api.readSessionSourceMessages.mockResolvedValueOnce([
      {
        id: "tool",
        role: "tool",
        toolName: "read_file",
        text: "[file:/tmp/report.md]",
      },
    ]);
    render("session-a", "v1");
    await act(async () => {});
    const first = captured.current;
    expect(first[0]).toMatchObject({
      origin: "tool-result",
      toolName: "read_file",
    });
    api.readSessionSourceMessages.mockResolvedValueOnce([
      {
        id: "assistant",
        role: "assistant",
        text: "[Implementation report](/tmp/report.md)",
      },
    ]);
    render("session-a", "v2");
    await act(async () => {});
    expect(captured.current).not.toBe(first);
    expect(captured.current[0]).toMatchObject({
      origin: "assistant-reference",
      title: "Implementation report",
    });
  });

  it("updates tool activity details without changing stable group identity", async () => {
    const activity = {
      callId: "search",
      toolName: "web.search",
      group: "web",
      status: "success",
      actions: [{ kind: "search", query: "original" }],
    };
    api.readSessionSourceMessages.mockResolvedValueOnce([
      { id: "tool", role: "tool", text: "", toolActivity: activity },
    ]);
    render("session-a", "v1");
    await act(async () => {});
    const first = captured.current;
    expect(first[0]).toMatchObject({
      kind: "tool-group",
      key: "tool-group:web",
    });
    api.readSessionSourceMessages.mockResolvedValueOnce([
      {
        id: "tool",
        role: "tool",
        text: "",
        toolActivity: {
          ...activity,
          status: "error",
          error: "No results",
          actions: [{ kind: "search", query: "updated" }],
        },
      },
    ]);
    render("session-a", "v2");
    await act(async () => {});
    expect(captured.current).not.toBe(first);
    expect(captured.current[0]).toMatchObject({
      key: "tool-group:web",
      operations: [
        {
          status: "error",
          error: "No results",
          actions: [{ query: "updated" }],
        },
      ],
    });
  });

  function setHidden(hidden: boolean) {
    act(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: hidden,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
  }

  it("defers a hidden initial mount until visibility returns without a hidden spinner", async () => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    api.readSessionSourceMessages.mockResolvedValue([]);
    render("session-a", "v1");
    expect(api.readSessionSourceMessages).not.toHaveBeenCalled();
    expect(captured.state).toMatchObject({ loading: false, error: false });
    setHidden(false);
    await act(async () => {});
    expect(api.readSessionSourceMessages).toHaveBeenCalledTimes(1);
  });

  it("coalesces hidden history updates into one latest read and retains previous rows", async () => {
    api.readSessionSourceMessages.mockResolvedValueOnce([
      { id: "old", text: "https://old.dev" },
    ]);
    render("session-a", "v1");
    await act(async () => {});
    const previous = captured.current;
    setHidden(true);
    render("session-a", "v2");
    render("session-a", "v3");
    expect(api.readSessionSourceMessages).toHaveBeenCalledTimes(1);
    expect(captured.current).toBe(previous);
    expect(captured.state?.loading).toBe(false);
    api.readSessionSourceMessages.mockResolvedValueOnce([
      { id: "latest", text: "https://latest.dev" },
    ]);
    setHidden(false);
    await act(async () => {});
    expect(api.readSessionSourceMessages).toHaveBeenCalledTimes(2);
    expect(captured.current[0]).toMatchObject({ messageId: "latest" });
    render("session-a", "v3");
    await act(async () => {});
    expect(api.readSessionSourceMessages).toHaveBeenCalledTimes(2);
  });

  it("preserves errors while hidden and revalidates unchanged history on return", async () => {
    api.readSessionSourceMessages.mockRejectedValueOnce(new Error("offline"));
    render("session-a", "v1");
    await act(async () => {});
    setHidden(true);
    render("session-a", "v2");
    expect(captured.state).toMatchObject({ loading: false, error: true });
    api.readSessionSourceMessages.mockResolvedValue([]);
    setHidden(false);
    await act(async () => {});
    expect(captured.state).toMatchObject({ loading: false, error: false });
    setHidden(true);
    setHidden(false);
    await act(async () => {});
    expect(api.readSessionSourceMessages).toHaveBeenCalledTimes(3);
  });

  it("reads nothing without a session", () => {
    render(null);
    expect(api.readSessionSourceMessages).not.toHaveBeenCalled();
    expect(captured.current).toEqual([]);
  });
});
