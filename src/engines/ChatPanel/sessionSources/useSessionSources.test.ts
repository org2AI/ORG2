// @vitest-environment jsdom
import React, { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionSource } from "./extractSessionSources";
import { useSessionSources } from "./useSessionSources";

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
  const captured: { current: SessionSource[] } = { current: [] };

  function Probe({
    sessionId,
    reloadKey,
  }: {
    sessionId: string | null;
    reloadKey?: string;
  }) {
    const sources = useSessionSources(sessionId, reloadKey);
    useEffect(() => {
      captured.current = sources;
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
    container = document.createElement("div");
    root = createRoot(container);
    captured.current = [];
  });

  afterEach(() => {
    act(() => root.unmount());
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
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

  it("reads nothing without a session", () => {
    render(null);
    expect(api.readSessionSourceMessages).not.toHaveBeenCalled();
    expect(captured.current).toEqual([]);
  });
});
