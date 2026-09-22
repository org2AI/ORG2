// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetCoalescedStorageWritesForTests,
  flushCoalescedStorageWrites,
  scheduleCoalescedStorageWrite,
  withCoalescedWrites,
} from "./coalescedStorageWrite";

describe("coalesced storage writes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _resetCoalescedStorageWritesForTests();
  });

  afterEach(() => {
    _resetCoalescedStorageWritesForTests();
    vi.useRealTimers();
  });

  it("collapses a drag's worth of writes for one key into a single write", () => {
    const write = vi.fn();
    // A resize handle calls once per animation frame; 120 frames is a ~2s drag.
    for (let frame = 0; frame < 120; frame++) {
      scheduleCoalescedStorageWrite("k", write);
      vi.advanceTimersByTime(16);
    }
    expect(write).not.toHaveBeenCalled();

    vi.advanceTimersByTime(200);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("keeps only the newest write for a key", () => {
    const seen: string[] = [];
    scheduleCoalescedStorageWrite("k", () => seen.push("first"));
    scheduleCoalescedStorageWrite("k", () => seen.push("second"));
    vi.advanceTimersByTime(200);
    expect(seen).toEqual(["second"]);
  });

  it("keeps distinct keys independent", () => {
    const a = vi.fn();
    const b = vi.fn();
    scheduleCoalescedStorageWrite("a", a);
    scheduleCoalescedStorageWrite("b", b);
    vi.advanceTimersByTime(200);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("flushes pending writes on demand so a quit cannot lose the last value", () => {
    const write = vi.fn();
    scheduleCoalescedStorageWrite("k", write);
    flushCoalescedStorageWrites();
    expect(write).toHaveBeenCalledTimes(1);

    // The queue is now empty; the timer must not fire it a second time.
    vi.advanceTimersByTime(200);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("runs every queued write even when one throws", () => {
    const after = vi.fn();
    scheduleCoalescedStorageWrite("bad", () => {
      throw new Error("quota");
    });
    scheduleCoalescedStorageWrite("good", after);
    expect(() => vi.advanceTimersByTime(200)).not.toThrow();
    expect(after).toHaveBeenCalledTimes(1);
  });

  describe("withCoalescedWrites", () => {
    it("defers setItem but answers getItem from the pending value", () => {
      const inner = {
        getItem: vi.fn((_key: string, initial: number) => initial),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      };
      const storage = withCoalescedWrites<number>(inner);

      storage.setItem("w", 320);
      expect(inner.setItem).not.toHaveBeenCalled();
      // A read between the write and the flush must not see the stale disk.
      expect(storage.getItem("w", 240)).toBe(320);

      vi.advanceTimersByTime(200);
      expect(inner.setItem).toHaveBeenCalledExactlyOnceWith("w", 320);
      // Once flushed the wrapper defers to the real storage again.
      expect(storage.getItem("w", 240)).toBe(240);
    });

    it("removes immediately so a queued write cannot resurrect the key", () => {
      const inner = {
        getItem: vi.fn((_key: string, initial: number) => initial),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      };
      const storage = withCoalescedWrites<number>(inner);

      storage.setItem("w", 320);
      storage.removeItem("w");
      expect(inner.removeItem).toHaveBeenCalledExactlyOnceWith("w");

      vi.advanceTimersByTime(200);
      expect(inner.setItem).not.toHaveBeenCalled();
    });
  });
});
