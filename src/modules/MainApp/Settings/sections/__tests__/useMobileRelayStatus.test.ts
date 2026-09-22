// @vitest-environment jsdom
import { act, createElement, useLayoutEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useMobileRelayStatus } from "../useMobileRelayStatus";

const mocks = vi.hoisted(() => ({ listen: vi.fn(), read: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@src/api/tauri/mobileRemote", () => ({
  mobileRemoteApi: { getRelayStatus: mocks.read },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
let root: Root;
let container: HTMLDivElement;
let latest: ReturnType<typeof useMobileRelayStatus>;
let changed: () => void;
const dispose = vi.fn();
function Probe({ scope = "desktop", enabled = true }) {
  const result = useMobileRelayStatus(scope, enabled);
  useLayoutEffect(() => {
    latest = result;
  });
  return createElement("span", null, result.data?.phase ?? "unknown");
}
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  root = createRoot(container);
  dispose.mockReset();
  mocks.listen.mockReset().mockImplementation(async (_event, handler) => {
    changed = handler;
    return dispose;
  });
  mocks.read.mockReset().mockResolvedValue({ phase: "disabled" });
});
afterEach(async () => {
  act(() => root.unmount());
  await flushDeferredCleanup();
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT;
});
async function render(scope = "desktop", enabled = true) {
  await act(async () => {
    root.render(createElement(Probe, { scope, enabled }));
  });
}
/** `safeUnlisten` defers the Tauri dispose to the next macrotask. */
async function flushDeferredCleanup() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

it("subscribes before hydration and updates disabled → connecting → online without polling", async () => {
  const subscription = deferred<() => void>();
  mocks.listen.mockImplementationOnce((_event, handler) => {
    changed = handler;
    return subscription.promise;
  });
  await render();
  expect(mocks.read).not.toHaveBeenCalled();
  await act(async () => subscription.resolve(dispose));
  expect(container.textContent).toBe("disabled");
  mocks.read.mockResolvedValueOnce({ phase: "connecting" });
  await act(async () => changed());
  expect(container.textContent).toBe("connecting");
  mocks.read.mockResolvedValueOnce({ phase: "online" });
  await act(async () => changed());
  expect(container.textContent).toBe("online");
  expect(mocks.read).toHaveBeenCalledTimes(3);
});

it("coalesces events during a read and never publishes its stale result", async () => {
  const old = deferred<{ phase: string }>();
  mocks.read
    .mockReturnValueOnce(old.promise)
    .mockResolvedValue({ phase: "online" });
  await render();
  act(() => {
    changed();
    changed();
    changed();
  });
  expect(mocks.read).toHaveBeenCalledTimes(1);
  await act(async () => old.resolve({ phase: "disabled" }));
  expect(mocks.read).toHaveBeenCalledTimes(2);
  expect(container.textContent).toBe("online");
});

it("cleans up late registration and ignores old scope responses", async () => {
  const subscription = deferred<() => void>();
  mocks.listen.mockReturnValueOnce(subscription.promise);
  await render("first");
  await render("second");
  await act(async () => subscription.resolve(dispose));
  await flushDeferredCleanup();
  expect(dispose).toHaveBeenCalledTimes(1);
  const old = deferred<{ phase: string }>();
  mocks.read.mockReturnValueOnce(old.promise);
  act(() => latest.refresh());
  await render("third");
  await act(async () => old.resolve({ phase: "online" }));
  expect(container.textContent).toBe("disabled");
  await render("third", false);
  expect(container.textContent).toBe("unknown");
  const calls = mocks.read.mock.calls.length;
  await act(async () => changed());
  expect(mocks.read).toHaveBeenCalledTimes(calls);
});

it("preserves known status on read failure and allows manual retry", async () => {
  await render();
  mocks.read.mockRejectedValueOnce(new Error("offline"));
  await act(async () => changed());
  expect(latest.error).toContain("offline");
  expect(latest.loading).toBe(false);
  expect(container.textContent).toBe("disabled");
  mocks.read.mockResolvedValueOnce({ phase: "online" });
  await act(async () => latest.refresh());
  expect(container.textContent).toBe("online");
});

it("keeps manual refresh available when event subscription fails", async () => {
  mocks.listen.mockRejectedValueOnce(new Error("events unavailable"));
  await render();
  expect(latest.manualRefreshRequired).toBe(true);
  expect(container.textContent).toBe("disabled");
  mocks.read.mockResolvedValueOnce({ phase: "online" });
  await act(async () => latest.refresh());
  expect(container.textContent).toBe("online");
  expect(latest.manualRefreshRequired).toBe(true);
  expect(mocks.read).toHaveBeenCalledTimes(2);
});

it("clears the manual fallback when a new scope subscribes successfully", async () => {
  mocks.listen.mockRejectedValueOnce(new Error("events unavailable"));
  await render("first");
  expect(latest.manualRefreshRequired).toBe(true);
  const subscription = deferred<() => void>();
  mocks.listen.mockReturnValueOnce(subscription.promise);
  await render("second");
  expect(latest.manualRefreshRequired).toBe(false);
  await act(async () => subscription.resolve(dispose));
  expect(latest.manualRefreshRequired).toBe(false);
});

it("clears the manual fallback when disabled and reenabled in the same scope", async () => {
  mocks.listen.mockRejectedValueOnce(new Error("events unavailable"));
  await render();
  expect(latest.manualRefreshRequired).toBe(true);
  await render("desktop", false);
  expect(latest.manualRefreshRequired).toBe(false);
  const subscription = deferred<() => void>();
  mocks.listen.mockReturnValueOnce(subscription.promise);
  await render();
  expect(latest.manualRefreshRequired).toBe(false);
  await act(async () => subscription.resolve(dispose));
  expect(latest.manualRefreshRequired).toBe(false);
});

it("waits for a fresh snapshot after reenabling while event registration is pending", async () => {
  mocks.read.mockResolvedValueOnce({ phase: "online" });
  await render();
  expect(container.textContent).toBe("online");
  await render("desktop", false);
  expect(latest.data).toBeNull();
  expect(latest.loading).toBe(false);
  const subscription = deferred<() => void>();
  mocks.listen.mockReturnValueOnce(subscription.promise);
  await render();
  expect(latest.data).toBeNull();
  expect(latest.loading).toBe(true);
  expect(latest.error).toBeNull();
  expect(mocks.read).toHaveBeenCalledTimes(1);
  mocks.read.mockResolvedValueOnce({ phase: "connecting" });
  await act(async () => subscription.resolve(dispose));
  expect(container.textContent).toBe("connecting");
  expect(latest.loading).toBe(false);
});

it("does not restore old status or errors when returning to an earlier scope", async () => {
  mocks.read.mockResolvedValueOnce({ phase: "online" });
  await render("first");
  mocks.read.mockRejectedValueOnce(new Error("old connection error"));
  await act(async () => changed());
  expect(latest.data?.phase).toBe("online");
  expect(latest.error).toContain("old connection error");
  const secondSubscription = deferred<() => void>();
  const returningSubscription = deferred<() => void>();
  mocks.listen
    .mockReturnValueOnce(secondSubscription.promise)
    .mockReturnValueOnce(returningSubscription.promise);
  await render("second");
  await render("first");
  expect(latest.data).toBeNull();
  expect(latest.loading).toBe(true);
  expect(latest.error).toBeNull();
  await act(async () => secondSubscription.resolve(dispose));
  expect(latest.data).toBeNull();
  expect(latest.loading).toBe(true);
  expect(mocks.read).toHaveBeenCalledTimes(2);
  mocks.read.mockResolvedValueOnce({ phase: "connecting" });
  await act(async () => returningSubscription.resolve(dispose));
  expect(container.textContent).toBe("connecting");
  expect(latest.loading).toBe(false);
  expect(latest.error).toBeNull();
});

it("disposes registration that resolves after the consumer unmounts", async () => {
  const subscription = deferred<() => void>();
  mocks.listen.mockReturnValueOnce(subscription.promise);
  await render();
  await act(async () => root.render(null));
  await act(async () => subscription.resolve(dispose));
  await flushDeferredCleanup();
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(mocks.read).not.toHaveBeenCalled();
});
