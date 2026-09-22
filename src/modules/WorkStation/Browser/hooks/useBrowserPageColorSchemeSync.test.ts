// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BROWSER_PAGE_COLOR_SCHEME_STORAGE_KEY,
  browserPageColorSchemeAtom,
} from "@src/store/workstation/browser/pageColorSchemeAtom";

import { useBrowserPageColorSchemeSync } from "./useBrowserPageColorSchemeSync";

const tauri = vi.hoisted(() => ({
  isMacOS: true,
  invokeTauri: vi.fn(async () => [] as string[]),
}));

vi.mock("@src/util/platform/tauri", () => ({
  isMacOS: () => tauri.isMacOS,
}));

vi.mock("@src/util/platform/tauri/init", () => ({
  invokeTauri: tauri.invokeTauri,
}));

function Probe(): null {
  useBrowserPageColorSchemeSync();
  return null;
}

describe("useBrowserPageColorSchemeSync", () => {
  let container: HTMLDivElement;
  let root: Root;
  let store: ReturnType<typeof createStore>;

  const mount = () => {
    act(() => {
      root.render(createElement(Provider, { store }, createElement(Probe)));
    });
  };

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.removeItem(BROWSER_PAGE_COLOR_SCHEME_STORAGE_KEY);
    tauri.isMacOS = true;
    store = createStore();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    vi.clearAllMocks();
  });

  it("sends the persisted scheme on mount, so a fresh process learns it", () => {
    store.set(browserPageColorSchemeAtom, "dark");
    mount();

    expect(tauri.invokeTauri).toHaveBeenCalledTimes(1);
    expect(tauri.invokeTauri).toHaveBeenCalledWith(
      "browser_webviews_set_color_scheme",
      { scheme: "dark" }
    );
  });

  it("re-sends whenever the user picks another scheme", () => {
    mount();
    expect(tauri.invokeTauri).toHaveBeenLastCalledWith(
      "browser_webviews_set_color_scheme",
      { scheme: "auto" }
    );

    act(() => store.set(browserPageColorSchemeAtom, "light"));

    expect(tauri.invokeTauri).toHaveBeenCalledTimes(2);
    expect(tauri.invokeTauri).toHaveBeenLastCalledWith(
      "browser_webviews_set_color_scheme",
      { scheme: "light" }
    );
  });

  it("stays silent where the native override does not exist", () => {
    tauri.isMacOS = false;
    mount();
    act(() => store.set(browserPageColorSchemeAtom, "dark"));

    expect(tauri.invokeTauri).not.toHaveBeenCalled();
  });
});
