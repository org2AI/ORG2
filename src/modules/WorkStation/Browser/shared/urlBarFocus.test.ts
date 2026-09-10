// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { BROWSER_URL_BAR_FOCUS_EVENT, focusBrowserUrlBar } from "./urlBarFocus";

afterEach(() => vi.unstubAllGlobals());

describe("browser URL bar focus", () => {
  it("waits two frames before notifying the mounted URL bar", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    const onFocus = vi.fn();
    window.addEventListener(BROWSER_URL_BAR_FOCUS_EVENT, onFocus);
    try {
      focusBrowserUrlBar();
      expect(onFocus).not.toHaveBeenCalled();
      expect(frames).toHaveLength(1);
      frames.shift()!(0);
      expect(onFocus).not.toHaveBeenCalled();
      expect(frames).toHaveLength(1);
      frames.shift()!(16);
      expect(onFocus).toHaveBeenCalledTimes(1);
      expect(frames).toHaveLength(0);
    } finally {
      window.removeEventListener(BROWSER_URL_BAR_FOCUS_EVENT, onFocus);
    }
  });
});
