// @vitest-environment jsdom
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useCrossWindowSettingsSync } from "../useCrossWindowSettingsSync";

const swap = vi.hoisted(() => vi.fn());
vi.mock("@src/util/ui/theme/swapThemeCss", () => ({ swapThemeCss: swap }));
vi.mock("@src/config/appearance/globalThemes", () => ({
  resolveGlobalThemePreference: (value: string) => value,
  getGlobalTheme: (value: string) => ({ baseCssPath: `/themes/${value}.css` }),
}));

let root: Root;
function Probe() {
  useCrossWindowSettingsSync();
  return null;
}
function storage(key: string | null, newValue: string | null) {
  window.dispatchEvent(new StorageEvent("storage", { key, newValue }));
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  swap.mockClear();
  root = createRoot(document.createElement("div"));
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

it("keeps theme and terminal zoom effects while ignoring other storage keys", () => {
  const zoom = vi.fn();
  const unusedEvent = vi.fn();
  window.addEventListener("uiScaleChange", zoom);
  window.addEventListener("cross-window-settings-changed", unusedEvent);
  try {
    act(() => root.render(createElement(Probe)));
    storage("theme", "dark");
    storage("orgii_ui_scale", "110");
    storage("orgii_other", "changed");
    storage("toString", "ignored");
    storage(null, null);
    storage("theme", null);
    expect(swap).toHaveBeenCalledTimes(1);
    expect(swap).toHaveBeenCalledWith("/themes/dark.css");
    expect(zoom).toHaveBeenCalledTimes(1);
    expect(unusedEvent).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener("uiScaleChange", zoom);
    window.removeEventListener("cross-window-settings-changed", unusedEvent);
  }
});

it("removes its listener on close and does not duplicate it on reopen", () => {
  act(() => root.render(createElement(Probe)));
  act(() => root.render(null));
  storage("theme", "closed");
  expect(swap).not.toHaveBeenCalled();
  act(() => root.render(createElement(Probe)));
  storage("theme", "reopened");
  expect(swap).toHaveBeenCalledTimes(1);
  expect(swap).toHaveBeenCalledWith("/themes/reopened.css");
});
