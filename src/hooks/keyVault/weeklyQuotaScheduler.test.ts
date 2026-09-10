// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  QUOTA_SAMPLE_INTERVAL_MS,
  startWeeklyQuotaScheduler,
} from "./weeklyQuotaScheduler";

const warn = vi.hoisted(() => vi.fn());
vi.mock("@src/hooks/logger", () => ({ createLogger: () => ({ warn }) }));

beforeEach(() => {
  warn.mockClear();
  vi.useFakeTimers();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("weekly quota scheduler", () => {
  it("runs hourly, pauses hidden/offline, and disposes its timer", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const stop = startWeeklyQuotaScheduler(run, vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(QUOTA_SAMPLE_INTERVAL_MS - 1);
    expect(run).toHaveBeenCalledTimes(1);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(3 * QUOTA_SAMPLE_INTERVAL_MS);
    expect(run).toHaveBeenCalledTimes(1);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(2);
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    window.dispatchEvent(new Event("offline"));
    expect(vi.getTimerCount()).toBe(0);
    stop();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    window.dispatchEvent(new Event("online"));
    expect(run).toHaveBeenCalledTimes(2);
  });
  it("does not overlap in-flight work or continue after disposal", async () => {
    let finish!: () => void;
    let active!: () => boolean;
    const run = vi.fn((isActive: () => boolean) => {
      active = isActive;
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    const stop = startWeeklyQuotaScheduler(run, vi.fn());
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(2 * QUOTA_SAMPLE_INTERVAL_MS);
    expect(run).toHaveBeenCalledTimes(1);
    stop();
    expect(active()).toBe(false);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("retries failures only on the next hourly timer", async () => {
    const run = vi.fn().mockRejectedValue(new Error("offline"));
    const error = vi.fn();
    const stop = startWeeklyQuotaScheduler(run, error);
    await vi.advanceTimersByTimeAsync(QUOTA_SAMPLE_INTERVAL_MS - 1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    stop();
  });
  it("contains error callback failures and retains hourly scheduling", async () => {
    const run = vi.fn().mockRejectedValue(new Error("offline"));
    const onError = vi.fn(() => {
      throw new Error("callback failed");
    });
    const stop = startWeeklyQuotaScheduler(run, onError);
    await vi.advanceTimersByTimeAsync(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(QUOTA_SAMPLE_INTERVAL_MS);
    expect(run).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledTimes(3);
    stop();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("coalesces account changes during a request into one immediate follow-up", async () => {
    let complete!: () => void;
    let changed!: () => void;
    const unsubscribe = vi.fn();
    const run = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            complete = resolve;
          })
      )
      .mockResolvedValue(undefined);
    const stop = startWeeklyQuotaScheduler(run, vi.fn(), (wake) => {
      changed = wake;
      return unsubscribe;
    });
    changed();
    changed();
    changed();
    expect(run).toHaveBeenCalledTimes(1);
    complete();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);
    stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
