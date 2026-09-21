import { afterEach, expect, it, vi } from "vitest";

import type { MobileSidebarSessionSnapshotRow } from "@src/api/tauri/mobileRemote";

import { createMobileSidebarPublisher } from "./mobileSidebarPublisher";

afterEach(() => vi.useRealTimers());

it("bounds publication retries and stops scheduling after repeated rejection", async () => {
  vi.useFakeTimers();
  const error = new Error("IPC unavailable");
  const publish = vi.fn().mockRejectedValue(error);
  const onError = vi.fn();
  const publisher = createMobileSidebarPublisher(publish, onError);
  publisher.update(publisher.acquire(), "local", []);

  await vi.runAllTimersAsync();

  expect(publish).toHaveBeenCalledTimes(2);
  expect(onError).toHaveBeenCalledTimes(2);
  expect(onError).toHaveBeenCalledWith(error);
  expect(vi.getTimerCount()).toBe(0);
});

it("handles a rejection escaping the scheduled flush", async () => {
  vi.useFakeTimers();
  const reportError = new Error("report failed");
  const onError = vi.fn().mockImplementationOnce(() => {
    throw reportError;
  });
  const publisher = createMobileSidebarPublisher(
    vi.fn().mockRejectedValue(new Error("IPC unavailable")),
    onError
  );
  publisher.update(publisher.acquire(), "local", []);

  await vi.runAllTimersAsync();

  expect(onError).toHaveBeenLastCalledWith(reportError);
  expect(vi.getTimerCount()).toBe(0);
});

const row = (id: string): MobileSidebarSessionSnapshotRow => ({
  id,
  name: id,
  status: "idle" as const,
  repoPath: null,
  repoName: null,
  updatedAtMs: null,
});

it("closing a duplicate consumer preserves the remaining owner's updates", async () => {
  vi.useFakeTimers();
  const publish = vi.fn().mockResolvedValue(true);
  const publisher = createMobileSidebarPublisher(publish, vi.fn());
  const docked = publisher.acquire();
  publisher.update(docked, "a", [row("first")]);
  await vi.runAllTimersAsync();
  const hover = publisher.acquire();
  publisher.update(hover, "a", [row("first")]);
  publisher.release(hover);
  publisher.update(docked, "a", [row("second")]);
  await vi.runAllTimersAsync();
  publisher.revalidate(docked);
  await vi.runAllTimersAsync();
  expect(
    publish.mock.calls.map(([rows]) => rows.map(({ id }: { id: string }) => id))
  ).toEqual([["first"], ["second"], ["second"]]);
  publisher.release(docked);
  await vi.runAllTimersAsync();
  expect(publish).toHaveBeenLastCalledWith([]);
});

it("never clears the last good snapshot for a rejected same-scope update", async () => {
  vi.useFakeTimers();
  let stored = [row("initial")];
  const publish = vi.fn(async (rows: readonly ReturnType<typeof row>[]) => {
    if (rows.some(({ id }) => id === "invalid")) throw new Error("validation");
    stored = [...rows];
  });
  const publisher = createMobileSidebarPublisher(publish, vi.fn());
  const token = publisher.acquire();
  publisher.update(token, "a", [row("good")]);
  await vi.runAllTimersAsync();
  publisher.update(token, "a", [row("invalid")]);
  await vi.runAllTimersAsync();
  expect(stored).toEqual([row("good")]);
  expect(publish).toHaveBeenCalledTimes(3);
  expect(publish.mock.calls.every(([rows]) => rows.length > 0)).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
  publisher.update(token, "a", [row("recovered")]);
  await vi.runAllTimersAsync();
  expect(stored).toEqual([row("recovered")]);
});

it("retries failed identity invalidation before allowing the new scope to publish", async () => {
  vi.useFakeTimers();
  const publish = vi.fn().mockResolvedValue(true);
  const publisher = createMobileSidebarPublisher(publish, vi.fn());
  const token = publisher.acquire();
  publisher.update(token, "old-user", [row("private-old")]);
  await vi.runAllTimersAsync();
  publish.mockRejectedValueOnce(new Error("offline"));
  publisher.update(token, "new-user", [row("private-new")]);
  await vi.runAllTimersAsync();
  expect(
    publish.mock.calls.map(([rows]) => rows.map(({ id }: { id: string }) => id))
  ).toEqual([["private-old"], [], [], ["private-new"]]);
});
