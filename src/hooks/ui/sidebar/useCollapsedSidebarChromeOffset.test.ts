import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getCollapsedSidebarButtonLeft,
  getCollapsedSidebarChromeOffset,
} from "./useCollapsedSidebarChromeOffset";

const { hasMacWindowChromeMock } = vi.hoisted(() => ({
  hasMacWindowChromeMock: vi.fn(),
}));

vi.mock("@src/config/windowChromeRadius", () => ({
  hasMacWindowChrome: hasMacWindowChromeMock,
}));

describe("getCollapsedSidebarChromeOffset", () => {
  beforeEach(() => {
    hasMacWindowChromeMock.mockReset();
  });

  it("reserves native traffic-light space, Back / Forward, and the toggle on macOS", () => {
    hasMacWindowChromeMock.mockReturnValue(true);

    expect(getCollapsedSidebarButtonLeft()).toBe(88);
    expect(getCollapsedSidebarChromeOffset()).toBe(176);
  });

  it("swaps the traffic-light reserve for a small edge inset in macOS native full screen", () => {
    hasMacWindowChromeMock.mockReturnValue(true);

    // Native full screen hides the traffic lights; the group keeps 8px more
    // than the bare 8px inset so it does not hug the screen edge.
    expect(getCollapsedSidebarButtonLeft({ fullscreen: true })).toBe(16);
    expect(getCollapsedSidebarChromeOffset({ fullscreen: true })).toBe(104);
    expect(getCollapsedSidebarButtonLeft({ fullscreen: false })).toBe(88);
    expect(getCollapsedSidebarChromeOffset({ fullscreen: false })).toBe(176);
  });

  it("reserves Back / Forward and the standalone sidebar toggle on Windows, Linux, or the browser", () => {
    hasMacWindowChromeMock.mockReturnValue(false);

    expect(getCollapsedSidebarButtonLeft()).toBe(8);
    expect(getCollapsedSidebarChromeOffset()).toBe(96);
    expect(getCollapsedSidebarButtonLeft({ fullscreen: true })).toBe(8);
    expect(getCollapsedSidebarChromeOffset({ fullscreen: true })).toBe(96);
  });
});
