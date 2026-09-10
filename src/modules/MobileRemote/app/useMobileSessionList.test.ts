// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import type { MobileRpcClient } from "../connection/mobileRpcClient";
import { useMobileSessionList } from "./useMobileSessionList";

describe("useMobileSessionList", () => {
  it("invalidates old roster requests on reset and restarts pagination", async () => {
    const env = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    };
    env.IS_REACT_ACT_ENVIRONMENT = true;
    let resolve!: (value: unknown) => void;
    const pending = new Promise((r) => {
      resolve = r;
    });
    const call = vi
      .fn()
      .mockReturnValueOnce(pending)
      .mockResolvedValue({ sessions: [], nextOffset: 50, hasMore: true });
    const client = { call } as unknown as MobileRpcClient;
    const clientRef = { current: client as MobileRpcClient | null };
    let roster!: ReturnType<typeof useMobileSessionList>;
    function Harness() {
      const value = useMobileSessionList(clientRef);
      React.useLayoutEffect(() => {
        roster = value;
      });
      return null;
    }
    const root = createRoot(document.createElement("div"));
    try {
      await act(async () => root.render(React.createElement(Harness)));
      let request!: Promise<void>;
      await act(async () => {
        request = roster.requestSessionList(client);
      });
      await act(async () => roster.resetSessions());
      await act(async () => {
        resolve({ sessions: [{ id: "old-desktop" }], hasMore: false });
        await request;
      });
      expect(roster.sessions).toEqual([]);
      await act(async () => roster.requestSessionList(client));
      expect(roster.sessionsHasMore).toBe(true);
      await act(async () => roster.resetSessions());
      expect(roster.sessionsHasMore).toBe(false);
      await act(async () => roster.requestSessionList(client));
      expect(call).toHaveBeenLastCalledWith("session/list", { offset: 0 });
    } finally {
      await act(async () => root.unmount());
      env.IS_REACT_ACT_ENVIRONMENT = false;
    }
  });
  it("coalesces a burst into one in-flight read and one trailing refresh", async () => {
    const env = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    };
    env.IS_REACT_ACT_ENVIRONMENT = true;
    let finish!: (value: unknown) => void;
    const call = vi
      .fn()
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        })
      )
      .mockResolvedValue({ sessions: [{ id: "fresh" }], hasMore: false });
    const client = { call } as unknown as MobileRpcClient;
    const clientRef = { current: client };
    let roster!: ReturnType<typeof useMobileSessionList>;
    function Probe() {
      const value = useMobileSessionList(clientRef);
      React.useLayoutEffect(() => {
        roster = value;
      });
      return null;
    }
    const root = createRoot(document.createElement("div"));
    try {
      await act(async () => root.render(React.createElement(Probe)));
      let first!: Promise<void>;
      await act(async () => {
        first = roster.requestSessionList(client);
      });
      const requests = Array.from({ length: 10 }, () =>
        roster.requestSessionList(client)
      );
      expect(call).toHaveBeenCalledTimes(1);
      expect(requests.every((request) => request === first)).toBe(true);
      await act(async () => {
        finish({ sessions: [{ id: "stale" }], hasMore: false });
        await first;
      });
      expect(call).toHaveBeenCalledTimes(2);
      expect(roster.sessions.map((row) => row.id)).toEqual(["fresh"]);
    } finally {
      await act(async () => root.unmount());
      env.IS_REACT_ACT_ENVIRONMENT = false;
    }
  });

  it("drops queued old-client reads on reset and releases a rejected flight for retry", async () => {
    const env = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    };
    env.IS_REACT_ACT_ENVIRONMENT = true;
    let finish!: (value: unknown) => void;
    const oldCall = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const oldClient = { call: oldCall } as unknown as MobileRpcClient;
    const call = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ sessions: [{ id: "new" }], hasMore: false });
    const client = { call } as unknown as MobileRpcClient;
    const clientRef = { current: oldClient };
    let roster!: ReturnType<typeof useMobileSessionList>;
    function Probe() {
      const value = useMobileSessionList(clientRef);
      React.useLayoutEffect(() => {
        roster = value;
      });
      return null;
    }
    const root = createRoot(document.createElement("div"));
    try {
      await act(async () => root.render(React.createElement(Probe)));
      let oldRequest!: Promise<void>;
      await act(async () => {
        oldRequest = roster.requestSessionList(oldClient);
      });
      roster.requestSessionList(oldClient);
      await act(async () => {
        clientRef.current = client;
        roster.resetSessions();
      });
      await act(async () => {
        await expect(roster.requestSessionList(client)).rejects.toThrow(
          "offline"
        );
      });
      await act(async () => {
        await roster.requestSessionList(client);
      });
      await act(async () => {
        finish({ sessions: [{ id: "old" }], hasMore: true, nextOffset: 50 });
        await oldRequest;
      });
      expect(oldCall).toHaveBeenCalledTimes(1);
      expect(roster.sessions.map((row) => row.id)).toEqual(["new"]);
    } finally {
      await act(async () => root.unmount());
      env.IS_REACT_ACT_ENVIRONMENT = false;
    }
  });
});
