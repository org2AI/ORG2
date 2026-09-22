// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CHAT_SPLIT_RATIOS,
  MIN_WIDTH,
  getChatMaxWidth,
  getChatWidthForRatio,
  setChatSplitAreaWidth,
} from "./config";

beforeEach(() => {
  vi.stubGlobal("innerWidth", 1512);
  setChatSplitAreaWidth(0);
});

afterEach(() => {
  setChatSplitAreaWidth(0);
  vi.unstubAllGlobals();
});

describe("chat split area", () => {
  it("splits the measured area, not the window", () => {
    // What the sidebar leaves for the station and the chat pane: a 1512px
    // window with the 240px sidebar open, minus layout padding.
    setChatSplitAreaWidth(1252);

    expect(getChatWidthForRatio("half")).toBe(626);
    // The widest preset reaches the ceiling exactly, rather than clamping a
    // pixel short of itself.
    expect(getChatWidthForRatio("two-thirds")).toBe(getChatMaxWidth());
    expect(getChatWidthForRatio("two-thirds")).toBe(
      Math.floor(1252 * CHAT_SPLIT_RATIOS["two-thirds"])
    );
    // A third of this area is 417, under MIN_WIDTH, so the floor wins — the
    // narrowest preset stops shrinking before the pane becomes unusable.
    expect(getChatWidthForRatio("one-third")).toBe(MIN_WIDTH);
  });

  it("tracks the sidebar collapsing without reading sidebar state", () => {
    setChatSplitAreaWidth(1252);
    const withSidebar = getChatWidthForRatio("half");

    // Collapsing the sidebar widens the same element; nothing else changes.
    setChatSplitAreaWidth(1492);
    expect(getChatWidthForRatio("half")).toBe(746);
    expect(getChatWidthForRatio("half")).toBeGreaterThan(withSidebar);
  });

  it("falls back to a window estimate until the area is measured", () => {
    // 1512 window − 240 assumed sidebar − 20 gutter.
    expect(getChatMaxWidth()).toBe(
      Math.floor(1252 * CHAT_SPLIT_RATIOS["two-thirds"])
    );
  });

  it("keeps an explicit viewport authoritative over the measurement", () => {
    setChatSplitAreaWidth(1252);
    // The pane's own responsive clamp asks about a specific window.
    expect(getChatMaxWidth(1000)).toBe(
      Math.floor((1000 - 240 - 20) * CHAT_SPLIT_RATIOS["two-thirds"])
    );
  });

  it("ignores a cleared or nonsense measurement", () => {
    setChatSplitAreaWidth(1252);
    setChatSplitAreaWidth(0);
    expect(getChatMaxWidth()).toBe(
      Math.floor(1252 * CHAT_SPLIT_RATIOS["two-thirds"])
    );

    setChatSplitAreaWidth(Number.NaN);
    expect(getChatMaxWidth()).toBe(
      Math.floor(1252 * CHAT_SPLIT_RATIOS["two-thirds"])
    );
  });
});
