import { expect, it, vi } from "vitest";

import { ConnectionLifecycle } from "./ConnectionLifecycle";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

it("single-flights opens and releases exactly one lease", async () => {
  const release = vi.fn(async () => {});
  const lifecycle = new ConnectionLifecycle<string>(release);
  const pending = deferred<string>();
  const open = vi.fn(() => pending.promise);
  const first = lifecycle.connect(open);
  expect(lifecycle.connect(open)).toBe(first);
  await flush();
  expect(open).toHaveBeenCalledTimes(1);
  pending.resolve("one");
  await first;
  expect(lifecycle.status.state).toBe("connected");
  await lifecycle.disconnect();
  await lifecycle.disconnect();
  expect(release).toHaveBeenCalledTimes(1);
  expect(release).toHaveBeenCalledWith("one");
});

it("a cancelled late open is released before a reconnect can publish", async () => {
  const release = vi.fn(async () => {});
  const lifecycle = new ConnectionLifecycle<string>(release);
  const pending = deferred<string>();
  const old = lifecycle.connect(() => pending.promise);
  const rejected = expect(old).rejects.toThrow("cancelled");
  await flush();
  const close = lifecycle.disconnect();
  const nextOpen = vi.fn(async () => "new");
  const next = lifecycle.connect(nextOpen);
  await flush();
  expect(nextOpen).not.toHaveBeenCalled();
  pending.resolve("old");
  await rejected;
  await close;
  await next;
  expect(release).toHaveBeenCalledTimes(1);
  expect(release).toHaveBeenCalledWith("old");
  expect(lifecycle.current).toBe("new");
});

it("an open error and a close error both permit retry", async () => {
  const release = vi
    .fn()
    .mockRejectedValueOnce(new Error("close failed"))
    .mockResolvedValue(undefined);
  const lifecycle = new ConnectionLifecycle<string>(release);
  await expect(
    lifecycle.connect(async () => {
      throw new Error("offline");
    })
  ).rejects.toThrow("offline");
  expect(lifecycle.status).toEqual({ state: "error", error: "offline" });
  await lifecycle.connect(async () => "first");
  await expect(lifecycle.disconnect()).rejects.toThrow("close failed");
  await lifecycle.connect(async () => "retry");
  expect(lifecycle.current).toBe("retry");
});
