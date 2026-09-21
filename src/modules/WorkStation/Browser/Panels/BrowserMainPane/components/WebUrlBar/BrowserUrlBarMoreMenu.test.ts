// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BROWSER_PAGE_COLOR_SCHEME_STORAGE_KEY,
  browserPageColorSchemeAtom,
} from "@src/store/workstation/browser/pageColorSchemeAtom";

import {
  BrowserUrlBarMoreMenu,
  type BrowserUrlBarMoreMenuProps,
} from "./BrowserUrlBarMoreMenu";

const dropdown = vi.hoisted(() => ({ close: vi.fn() }));
const platform = vi.hoisted(() => ({ pageThemeSupported: true }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@src/components/KeyboardShortcut/ToolbarTooltip", () => ({
  ToolbarTooltip: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@src/hooks/dropdown", () => ({
  getDropdownPanelStyle: () => ({}),
  useDropdownEngine: () => ({
    isOpen: true,
    isPositioned: true,
    toggle: vi.fn(),
    close: dropdown.close,
    triggerRef: { current: null },
    panelRef: { current: null },
    panelPosition: { left: 0, top: 0, width: 220 },
  }),
}));

vi.mock("@src/components/Dropdown/ActionMenuSurface", async () => {
  const React = await import("react");
  return {
    ActionMenuSurface: ({ children }: { children: React.ReactNode }) =>
      React.createElement("div", { "data-testid": "menu-surface" }, children),
  };
});

vi.mock(
  "@src/modules/WorkStation/Browser/hooks/useBrowserPageColorSchemeSync",
  () => ({
    isBrowserPageColorSchemeSupported: () => platform.pageThemeSupported,
  })
);

describe("BrowserUrlBarMoreMenu", () => {
  let container: HTMLDivElement;
  let root: Root;
  let store: ReturnType<typeof createStore>;

  const render = (props: BrowserUrlBarMoreMenuProps) => {
    act(() => {
      root.render(
        createElement(
          Provider,
          { store },
          createElement(BrowserUrlBarMoreMenu, props)
        )
      );
    });
  };

  const menuItem = (testId: string) =>
    document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.removeItem(BROWSER_PAGE_COLOR_SCHEME_STORAGE_KEY);
    platform.pageThemeSupported = true;
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

  it("lists page theme, the file actions, then native DevTools", () => {
    render({
      onSaveScreenshot: vi.fn(),
      canSaveScreenshot: true,
      onOpenHtmlFile: vi.fn(),
      onImportCookies: vi.fn(),
      onOpenNativeDevTools: vi.fn(),
      canOpenNativeDevTools: true,
    });

    const ids = [
      ...menuItem("menu-surface")!.querySelectorAll("[data-testid]"),
    ].map((node) => node.getAttribute("data-testid"));
    expect(ids).toEqual([
      "browser-page-theme",
      "browser-save-screenshot",
      "browser-open-html-file",
      "browser-import-cookies",
      "browser-open-native-devtools",
    ]);
    expect(document.querySelectorAll('[role="separator"]')).toHaveLength(2);
  });

  it("offers cookie import only when the host wires it up", () => {
    const onImportCookies = vi.fn();
    render({ onOpenHtmlFile: vi.fn(), onImportCookies });

    const item = menuItem("browser-import-cookies");
    expect(item?.textContent).toBe("browserCookieImport.action");
    act(() => item?.click());
    expect(dropdown.close).toHaveBeenCalledTimes(1);
    expect(onImportCookies).toHaveBeenCalledTimes(1);

    // A private tab: the host passes no handler, so the entry is gone.
    render({ onOpenHtmlFile: vi.fn() });
    expect(menuItem("browser-import-cookies")).toBeNull();
  });

  it("keeps native DevTools inert until a webview exists", () => {
    const onOpenNativeDevTools = vi.fn();
    render({ onOpenNativeDevTools, canOpenNativeDevTools: false });

    const item = menuItem("browser-open-native-devtools");
    expect(item?.textContent).toBe("tooltips.openNativeDevTools");
    expect(item?.getAttribute("aria-disabled")).toBe("true");
    act(() => item?.click());
    expect(onOpenNativeDevTools).not.toHaveBeenCalled();

    render({ onOpenNativeDevTools, canOpenNativeDevTools: true });
    act(() => menuItem("browser-open-native-devtools")?.click());
    expect(dropdown.close).toHaveBeenCalledTimes(1);
    expect(onOpenNativeDevTools).toHaveBeenCalledTimes(1);
  });

  it("persists the chosen page theme without closing the menu", () => {
    render({ onOpenHtmlFile: vi.fn() });
    expect(store.get(browserPageColorSchemeAtom)).toBe("auto");

    const darkOption = [
      ...menuItem("browser-page-theme")!.querySelectorAll("button"),
    ].find(
      (button) => button.getAttribute("aria-label") === "browser.menu.themeDark"
    );
    act(() => darkOption?.click());

    expect(store.get(browserPageColorSchemeAtom)).toBe("dark");
    expect(darkOption?.getAttribute("aria-pressed")).toBe("true");
    expect(dropdown.close).not.toHaveBeenCalled();
  });

  it("closes the menu before running a file action", () => {
    const onOpenHtmlFile = vi.fn();
    render({ onOpenHtmlFile });

    act(() => menuItem("browser-open-html-file")?.click());

    expect(dropdown.close).toHaveBeenCalledTimes(1);
    expect(onOpenHtmlFile).toHaveBeenCalledTimes(1);
  });

  it("keeps save screenshot inert until a page is loaded", () => {
    const onSaveScreenshot = vi.fn();
    render({ onSaveScreenshot, canSaveScreenshot: false });

    const item = menuItem("browser-save-screenshot");
    expect(item?.getAttribute("aria-disabled")).toBe("true");
    act(() => item?.click());
    expect(onSaveScreenshot).not.toHaveBeenCalled();

    render({ onSaveScreenshot, canSaveScreenshot: true });
    act(() => menuItem("browser-save-screenshot")?.click());
    expect(onSaveScreenshot).toHaveBeenCalledTimes(1);
  });

  it("drops the page theme row where the platform cannot override it", () => {
    platform.pageThemeSupported = false;
    render({ onOpenHtmlFile: vi.fn() });

    expect(menuItem("browser-page-theme")).toBeNull();
    expect(menuItem("browser-open-html-file")).not.toBeNull();
    expect(document.querySelector('[role="separator"]')).toBeNull();
  });

  it("renders nothing when it would be an empty menu", () => {
    platform.pageThemeSupported = false;
    render({});

    expect(menuItem("browser-url-bar-more-button")).toBeNull();
  });
});
