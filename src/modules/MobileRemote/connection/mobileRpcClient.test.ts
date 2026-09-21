// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { createMobileRpcClient } from "./mobileRpcClient";
import {
  cachedMobileSessionIdentity,
  prefetchMobileSessionIdentities,
  resolveMobileSessionIdentity,
} from "./mobileSessionIdentityCache";

type WebSocketListener = (event: { data: string }) => void;

function createMockSocket() {
  const listeners = new Map<string, Set<WebSocketListener>>();
  const socket = {
    readyState: WebSocket.OPEN,
    send: vi.fn(),
    close: vi.fn(),
    addEventListener: (type: string, listener: WebSocketListener) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    emit(type: string, data: string) {
      for (const listener of listeners.get(type) ?? []) {
        listener({ data });
      }
    },
  };
  return socket;
}

const runtime = {
  setTimeout: (callback: () => void, delayMs: number) =>
    window.setTimeout(callback, delayMs),
  clearTimeout: (timeoutId: number) => window.clearTimeout(timeoutId),
};

describe("createMobileRpcClient", () => {
  it.each([
    "session/list_changed",
    "relay/presence",
    "close",
    "explicit-close",
  ])(
    "invalidates cached identities on %s even while no chat page is mounted",
    async (event) => {
      const socket = createMockSocket();
      const client = createMobileRpcClient(
        socket as unknown as WebSocket,
        runtime
      );
      const lookup = resolveMobileSessionIdentity(client, "mirror");
      await Promise.resolve();
      socket.emit(
        "message",
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { sessionId: "owner", managed: true },
        })
      );
      await lookup;
      expect(cachedMobileSessionIdentity(client, "mirror")).toBeDefined();
      if (event === "close") socket.emit("close", "");
      else if (event === "explicit-close") client.close();
      else
        socket.emit(
          "message",
          JSON.stringify({
            jsonrpc: "2.0",
            method: event,
            params: { online: false },
          })
        );
      expect(cachedMobileSessionIdentity(client, "mirror")).toBeUndefined();
    }
  );

  it("warms again after a real list-change notification without a mounted chat", async () => {
    const socket = createMockSocket();
    const client = createMobileRpcClient(
      socket as unknown as WebSocket,
      runtime
    );
    const rows = [
      { id: "codexapp-imported", name: "Codex", status: "idle" as const },
    ];
    const first = prefetchMobileSessionIdentities(client, rows);
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalledOnce());
    const request = JSON.parse(socket.send.mock.calls[0][0]);
    expect(request).toMatchObject({
      method: "session/resolve",
      params: { sessionId: rows[0].id },
    });
    socket.emit(
      "message",
      JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: { sessionId: "cliagent-before", managed: true },
      })
    );
    await first;
    socket.emit(
      "message",
      JSON.stringify({ jsonrpc: "2.0", method: "session/list_changed" })
    );
    expect(cachedMobileSessionIdentity(client, rows[0].id)).toBeUndefined();
    const refreshed = prefetchMobileSessionIdentities(client, rows);
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalledTimes(2));
    const next = JSON.parse(socket.send.mock.calls[1][0]);
    socket.emit(
      "message",
      JSON.stringify({
        jsonrpc: "2.0",
        id: next.id,
        result: { sessionId: "cliagent-after", managed: true },
      })
    );
    await refreshed;
    expect(cachedMobileSessionIdentity(client, rows[0].id)?.sessionId).toBe(
      "cliagent-after"
    );
    await resolveMobileSessionIdentity(client, rows[0].id);
    expect(socket.send).toHaveBeenCalledTimes(2);
    client.close();
  });

  it("aborts locally, ignores the late reply, and allows another RPC immediately", async () => {
    vi.useFakeTimers();
    try {
      const socket = createMockSocket();
      const client = createMobileRpcClient(
        socket as unknown as WebSocket,
        runtime
      );
      const controller = new AbortController();
      const remove = vi.spyOn(controller.signal, "removeEventListener");
      const old = client.call("session/list", {}, controller.signal);
      const rejected = expect(old).rejects.toMatchObject({
        name: "AbortError",
      });
      controller.abort();
      await rejected;
      expect(remove).toHaveBeenCalledOnce();
      const fresh = client.call("session/list");
      socket.emit(
        "message",
        JSON.stringify({ jsonrpc: "2.0", id: 2, result: "fresh" })
      );
      await expect(fresh).resolves.toBe("fresh");
      socket.emit(
        "message",
        JSON.stringify({ jsonrpc: "2.0", id: 1, result: "old" })
      );
      expect(vi.getTimerCount()).toBe(0);
      expect(socket.close).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not send pre-aborted requests or leak resources after send failure", async () => {
    vi.useFakeTimers();
    try {
      const socket = createMockSocket();
      const client = createMobileRpcClient(
        socket as unknown as WebSocket,
        runtime
      );
      const controller = new AbortController();
      controller.abort();
      await expect(
        client.call("session/list", {}, controller.signal)
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(socket.send).not.toHaveBeenCalled();
      socket.send.mockImplementation(() => {
        throw new Error("send failed");
      });
      await expect(client.call("session/list")).rejects.toThrow("send failed");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps aborted wire requests bounded and releases tombstones on timeout and close", async () => {
    vi.useFakeTimers();
    try {
      const socket = createMockSocket();
      const client = createMobileRpcClient(
        socket as unknown as WebSocket,
        runtime
      );
      for (let i = 0; i < 128; i++) {
        const controller = new AbortController();
        const request = client.call("session/list", {}, controller.signal);
        const rejected = expect(request).rejects.toMatchObject({
          name: "AbortError",
        });
        controller.abort();
        await rejected;
      }
      await expect(client.call("session/list")).rejects.toThrow(
        "Too many pending"
      );
      await vi.advanceTimersByTimeAsync(15_000);
      expect(vi.getTimerCount()).toBe(0);
      const pending = client.call("session/list");
      client.close();
      await expect(pending).rejects.toThrow("RPC client closed");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it("resolves call results by id", async () => {
    const socket = createMockSocket();
    const client = createMobileRpcClient(
      socket as unknown as WebSocket,
      runtime
    );
    const promise = client.call<{ ok: boolean }>("initialize", {
      protocolVersion: 1,
    });
    expect(socket.send).toHaveBeenCalledOnce();
    socket.emit(
      "message",
      JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } })
    );
    await expect(promise).resolves.toEqual({ ok: true });
  });

  it("rejects on rpc error", async () => {
    const socket = createMockSocket();
    const client = createMobileRpcClient(
      socket as unknown as WebSocket,
      runtime
    );
    const promise = client.call("session/list");
    socket.emit(
      "message",
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        error: { code: 401, message: "Unauthorized" },
      })
    );
    await expect(promise).rejects.toMatchObject({
      message: "Unauthorized",
      code: 401,
    });
  });

  it("dispatches notifications without id", () => {
    const socket = createMockSocket();
    const client = createMobileRpcClient(
      socket as unknown as WebSocket,
      runtime
    );
    const handler = vi.fn();
    client.onNotification(handler);
    socket.emit(
      "message",
      JSON.stringify({
        jsonrpc: "2.0",
        method: "orgii/event",
        params: { channel: "bus" },
      })
    );
    expect(handler).toHaveBeenCalledWith("orgii/event", { channel: "bus" });
  });

  it("bounds an unanswered call with a timeout", async () => {
    vi.useFakeTimers();
    try {
      const socket = createMockSocket();
      const client = createMobileRpcClient(
        socket as unknown as WebSocket,
        runtime
      );
      const promise = client.call("session/list");
      const expectation = expect(promise).rejects.toThrow(
        "RPC call timed out: session/list"
      );
      await vi.advanceTimersByTimeAsync(15_000);
      await expectation;
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects outstanding calls when the socket closes", async () => {
    const socket = createMockSocket();
    const client = createMobileRpcClient(
      socket as unknown as WebSocket,
      runtime
    );
    const promise = client.call("session/list");
    socket.emit("close", "");
    await expect(promise).rejects.toThrow("WebSocket closed");
  });
});
