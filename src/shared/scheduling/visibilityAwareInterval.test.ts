// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";

import { startVisibilityAwareInterval } from "./visibilityAwareInterval";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it("parks hidden timers, catches up once, and releases listeners on stop", () => {
  vi.useFakeTimers();
  let hidden = true;
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() =>
    hidden ? "hidden" : "visible"
  );
  const tick = vi.fn();
  const suspend = vi.fn();
  const stop = startVisibilityAwareInterval(document, tick, 1000, suspend);
  expect(vi.getTimerCount()).toBe(0);
  hidden = false;
  document.dispatchEvent(new Event("visibilitychange"));
  expect(tick).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(2000);
  expect(tick).toHaveBeenCalledTimes(3);
  hidden = true;
  document.dispatchEvent(new Event("visibilitychange"));
  expect(vi.getTimerCount()).toBe(0);
  vi.advanceTimersByTime(100_000);
  expect(tick).toHaveBeenCalledTimes(3);
  hidden = false;
  document.dispatchEvent(new Event("visibilitychange"));
  expect(tick).toHaveBeenCalledTimes(4);
  document.dispatchEvent(new Event("visibilitychange"));
  expect(tick).toHaveBeenCalledTimes(4);
  stop();
  expect(vi.getTimerCount()).toBe(0);
  document.dispatchEvent(new Event("visibilitychange"));
  expect(tick).toHaveBeenCalledTimes(4);
});
