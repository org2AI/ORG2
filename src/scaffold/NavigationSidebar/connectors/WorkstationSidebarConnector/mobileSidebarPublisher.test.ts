import { afterEach, expect, it, vi } from "vitest";

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
