// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import {
  type Mock,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  MobileRpcClient,
  RpcNotificationHandler,
} from "../connection/mobileRpcClient";
import type { MobilePendingPermission } from "../connection/types";
import type { MobileRemoteRuntimePort } from "../platform/types";
import { useMobilePendingInbox } from "./useMobilePendingInbox";

function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
const item = (requestId: string): MobilePendingPermission => ({
  kind: "permission",
  origin: "rust_agent",
  sessionId: `session-${requestId}`,
  requestId,
  toolName: "shell",
  toolArgs: { command: "pwd" },
  createdAtMs: 1000,
});
const snapshot = (id: string, complete = true) => ({
  interactions: [item(id)],
  complete,
});

describe("useMobilePendingInbox", () => {
  let root: ReturnType<typeof createRoot>;
  let current: ReturnType<typeof useMobilePendingInbox>;
  let hidden: boolean;
  let visibility: Set<() => void>;
  let notifications: Set<RpcNotificationHandler>;
  let runtime: MobileRemoteRuntimePort;
  let onSnapshot: Mock<(items: MobilePendingPermission[]) => void>;
  let props: Parameters<typeof useMobilePendingInbox>[0];
  function Harness() {
    const value = useMobilePendingInbox(props);
    React.useLayoutEffect(() => {
      current = value;
    });
    return null;
  }
  async function render() {
    await act(async () => root.render(React.createElement(Harness)));
  }
  function client(call: ReturnType<typeof vi.fn>) {
    return {
      call,
      onNotification: (handler: RpcNotificationHandler) => {
        notifications.add(handler);
        return () => notifications.delete(handler);
      },
    } as unknown as MobileRpcClient;
  }
  async function push() {
    await act(async () => {
      for (const notify of notifications)
        notify("interaction/pending_changed", {});
    });
  }
  async function show(isHidden: boolean) {
    await act(async () => {
      hidden = isHidden;
      for (const listener of visibility) listener();
    });
  }
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    root = createRoot(document.createElement("div"));
    hidden = false;
    visibility = new Set();
    notifications = new Set();
    onSnapshot = vi.fn<(items: MobilePendingPermission[]) => void>();
    runtime = {
      now: () => Date.now(),
      random: () => Math.random(),
      randomUUID: () => crypto.randomUUID(),
      setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
      clearTimeout: (timeoutId) => window.clearTimeout(timeoutId),
      portalContainer: () => document.body,
      isHidden: () => hidden,
      subscribeVisibility: (listener: () => void) => {
        visibility.add(listener);
        return () => visibility.delete(listener);
      },
    };
    props = {
      client: null,
      scope: "desktop-a",
      online: true,
      supported: true,
      runtime,
      onSnapshot,
    };
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    expect(visibility.size).toBe(0);
    expect(notifications.size).toBe(0);
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("hydrates the global snapshot, then removes desktop-resolved requests on push", async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce(snapshot("pending"))
      .mockResolvedValueOnce({ interactions: [], complete: true });
    props.client = client(call);
    await render();
    expect(current.items).toEqual([item("pending")]);
    expect(call).toHaveBeenCalledWith("interaction/pending_all", {});
    await push();
    expect(current).toMatchObject({
      phase: "ready",
      complete: true,
      items: [],
    });
    expect(onSnapshot).toHaveBeenLastCalledWith([]);
  });

  it("coalesces notification bursts during an in-flight read and rejects its stale snapshot", async () => {
    const old = deferred();
    const latest = deferred();
    const call = vi
      .fn()
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(latest.promise);
    props.client = client(call);
    await render();
    await push();
    await push();
    await push();
    expect(call).toHaveBeenCalledTimes(1);
    await act(async () => old.resolve(snapshot("old")));
    expect(call).toHaveBeenCalledTimes(2);
    expect(onSnapshot).not.toHaveBeenCalled();
    await act(async () => latest.resolve(snapshot("new")));
    expect(current.items).toEqual([item("new")]);
    expect(onSnapshot).toHaveBeenCalledTimes(1);
  });

  it("does no reads while hidden and revalidates once on visibility return", async () => {
    hidden = true;
    const call = vi.fn().mockResolvedValue(snapshot("visible"));
    props.client = client(call);
    await render();
    await push();
    await push();
    expect(call).not.toHaveBeenCalled();
    await show(false);
    expect(call).toHaveBeenCalledTimes(1);
    await show(true);
    await push();
    expect(call).toHaveBeenCalledTimes(1);
    await show(false);
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("retains the known same-desktop snapshot offline without new calls", async () => {
    const call = vi.fn().mockResolvedValue(snapshot("known"));
    props.client = client(call);
    await render();
    props = { ...props, online: false };
    await render();
    await push();
    expect(current.items).toEqual([item("known")]);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("clears data across scope switch and rejects the old client's completion", async () => {
    const old = deferred();
    const next = deferred();
    props.client = client(vi.fn().mockReturnValue(old.promise));
    await render();
    props = {
      ...props,
      scope: "desktop-b",
      client: client(vi.fn().mockReturnValue(next.promise)),
    };
    await render();
    expect(current.items).toEqual([]);
    await act(async () => old.resolve(snapshot("old")));
    expect(current.items).toEqual([]);
    expect(onSnapshot).not.toHaveBeenCalled();
    await act(async () => next.resolve(snapshot("new")));
    expect(current.items).toEqual([item("new")]);
    expect(notifications.size).toBe(1);
    expect(visibility.size).toBe(1);
  });

  it("marks partial snapshots incomplete without authoritatively reconciling missing prompts", async () => {
    props.client = client(
      vi.fn().mockResolvedValue(snapshot("partial", false))
    );
    await render();
    expect(current).toMatchObject({
      phase: "ready",
      complete: false,
      items: [item("partial")],
    });
    expect(onSnapshot).not.toHaveBeenCalled();
  });

  it("retains known rows on failure and permits explicit retry", async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce(snapshot("known"))
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(snapshot("retried"));
    props.client = client(call);
    await render();
    await push();
    expect(current).toMatchObject({ phase: "error", items: [item("known")] });
    await act(async () => current.refresh());
    expect(current).toMatchObject({ phase: "ready", items: [item("retried")] });
  });

  it("does not request the RPC on unsupported Desktop versions", async () => {
    const call = vi.fn();
    props = { ...props, supported: false, client: client(call) };
    await render();
    await push();
    await act(async () => current.refresh());
    expect(call).not.toHaveBeenCalled();
    expect(current.phase).toBe("unsupported");
  });

  it("unmount disposes listeners and prevents a late snapshot from reconciling", async () => {
    const late = deferred();
    props.client = client(vi.fn().mockReturnValue(late.promise));
    await render();
    await act(async () => root.unmount());
    root = createRoot(document.createElement("div"));
    await act(async () => late.resolve(snapshot("late")));
    expect(onSnapshot).not.toHaveBeenCalled();
    expect(notifications.size).toBe(0);
    expect(visibility.size).toBe(0);
  });

  it.each([
    null,
    { interactions: [null], complete: true },
    { interactions: [{ ...item("bad"), toolArgs: null }], complete: true },
    {
      interactions: [{ ...item("bad"), origin: ["rust_agent"] }],
      complete: true,
    },
    { interactions: [{ ...item("bad"), createdAtMs: 1e20 }], complete: true },
    { interactions: [item("bad")], complete: "true" },
    {
      interactions: Array.from({ length: 2001 }, (_, id) => item(String(id))),
      complete: true,
    },
  ])(
    "rejects malformed pending payload before global reconciliation (%#)",
    async (payload) => {
      props.client = client(vi.fn().mockResolvedValue(payload));
      await render();
      expect(current).toMatchObject({
        phase: "error",
        items: [],
        complete: false,
      });
      expect(onSnapshot).not.toHaveBeenCalled();
    }
  );
});
