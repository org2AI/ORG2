// @vitest-environment jsdom
import React, { act, createRef } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DROPDOWN_PANEL } from "@src/components/Dropdown/tokens";
import { Copy01Icon, CursorInWindowIcon } from "@src/icons";
import type { SidebarMenuItem } from "@src/scaffold/NavigationSidebar/menus/types";

import { SidebarMenuHost, popupSidebarMenu } from "./SidebarMenu";

const nativeAppMount = vi.hoisted(() => vi.fn());
vi.mock("./SidebarSessionOpenInApp", () => ({
  SidebarSessionOpenInApp: ({
    sessionId,
    onClose,
  }: {
    sessionId: string;
    onClose: () => void;
  }) => {
    nativeAppMount(sessionId);
    return React.createElement(
      "button",
      { role: "menuitem", "data-testid": "native-app", onClick: onClose },
      "Open in Codex"
    );
  },
}));

describe("sidebar app menus", () => {
  let container: HTMLDivElement;
  let root: Root;
  let anchor: HTMLButtonElement;
  const sidebarRef = createRef<HTMLDivElement>();
  beforeEach(() => {
    nativeAppMount.mockClear();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() =>
      root.render(
        React.createElement(
          "div",
          { ref: sidebarRef },
          React.createElement(
            "div",
            { "data-menu-item-id": "row" },
            React.createElement(
              "button",
              { "aria-label": "More", "data-sidebar-menu-trigger": true },
              "More"
            )
          ),
          React.createElement(SidebarMenuHost, { sidebarRef })
        )
      )
    );
    anchor = container.querySelector("button")!;
    vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue({
      left: 20,
      bottom: 40,
    } as DOMRect);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  });
  async function open(items: SidebarMenuItem[], type = "click", x = 0, y = 0) {
    await act(async () =>
      popupSidebarMenu(
        {
          currentTarget: anchor,
          type,
          clientX: x,
          clientY: y,
        } as unknown as React.MouseEvent,
        { source: "test", buildItems: () => items }
      )
    );
  }
  const menu = () => document.querySelector<HTMLElement>("[data-sidebar-menu]");

  it("anchors button menus with the shared gap, preserves actions, and skips disabled rows", async () => {
    const action = vi.fn();
    await open([
      { text: "Disabled", enabled: false },
      { id: "copy", text: "Copy URL", action },
      { item: "Separator" },
      { text: "Pinned", checked: true },
    ]);
    expect(menu()?.style.top).toBe(`${40 + DROPDOWN_PANEL.triggerGap}px`);
    expect(document.activeElement?.textContent).toBe("Copy URL");
    expect(menu()?.querySelector('[role="separator"]')).not.toBeNull();
    expect(
      menu()
        ?.querySelector('[role="menuitemcheckbox"]')
        ?.getAttribute("aria-checked")
    ).toBe("true");
    act(() => (document.activeElement as HTMLElement).click());
    expect(action).toHaveBeenCalledExactlyOnceWith("copy");
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(anchor);
  });

  it("uses pointer coordinates for right-click and restores focus on Escape", async () => {
    await open([{ text: "Open" }], "contextmenu", 80, 90);
    expect(menu()?.style.left).toBe("80px");
    expect(menu()?.style.top).toBe("90px");
    act(() =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      )
    );
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(anchor);
  });

  it("opens shared submenus and runs their actions", async () => {
    const action = vi.fn();
    await open([
      {
        text: "Move to section",
        items: [{ text: "Section A", checked: true, action }],
      },
    ]);
    act(() => (document.activeElement as HTMLElement).click());
    const child = document.querySelector<HTMLElement>(
      '[role="menuitemcheckbox"]'
    );
    expect(child?.getAttribute("aria-checked")).toBe("true");
    act(() => child?.click());
    expect(action).toHaveBeenCalledOnce();
    expect(menu()).toBeNull();
  });

  it("replaces requests and releases open-menu listeners on close and unmount", async () => {
    const removeDocument = vi.spyOn(document, "removeEventListener");
    const removeWindow = vi.spyOn(window, "removeEventListener");
    await open([{ text: "Old" }]);
    await open([{ text: "New" }]);
    expect(document.querySelectorAll("[data-sidebar-menu]")).toHaveLength(1);
    expect(menu()?.textContent).toBe("New");
    act(() =>
      document.body.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true })
      )
    );
    expect(menu()).toBeNull();
    expect(
      removeDocument.mock.calls.some(([name]) => name === "mousedown")
    ).toBe(true);
    expect(removeWindow.mock.calls.some(([name]) => name === "resize")).toBe(
      true
    );
    await open([{ text: "Again" }]);
    act(() => root.render(null));
    expect(menu()).toBeNull();
    await open([{ text: "Detached" }]);
    expect(menu()).toBeNull();
  });

  it("clamps to viewport tokens and closes on window blur", async () => {
    await open([{ text: "Open" }], "contextmenu", -50, -20);
    expect(menu()?.style.left).toBe(`${DROPDOWN_PANEL.viewportPadding}px`);
    expect(menu()?.style.top).toBe(`${DROPDOWN_PANEL.viewportPadding}px`);
    act(() => window.dispatchEvent(new Event("blur")));
    expect(menu()).toBeNull();
  });
  it("flips above a low trigger with the same token gap", async () => {
    vi.mocked(anchor.getBoundingClientRect).mockReturnValue({
      left: 20,
      top: window.innerHeight - 40,
      bottom: window.innerHeight - 20,
    } as DOMRect);
    vi.spyOn(HTMLDivElement.prototype, "getBoundingClientRect").mockReturnValue(
      { width: 200, height: 120 } as DOMRect
    );
    await open([{ text: "Open" }]);
    expect(menu()?.style.top).toBe(
      `${window.innerHeight - 40 - 120 - DROPDOWN_PANEL.triggerGap}px`
    );
  });

  it("releases the overlay when the document is hidden", async () => {
    await open([{ text: "Open" }]);
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(menu()).toBeNull();
  });
  it("holds the row hover and overflow active state until dismissal", async () => {
    const row = container.querySelector("[data-menu-item-id]")!;
    await open([{ text: "Open in", items: [{ text: "New tab" }] }]);
    expect(row.getAttribute("data-sidebar-menu-open")).toBe("true");
    expect(anchor.getAttribute("data-sidebar-menu-open")).toBe("true");
    expect(anchor.getAttribute("aria-expanded")).toBe("true");
    act(() => (document.activeElement as HTMLElement).click());
    expect(row.getAttribute("data-sidebar-menu-open")).toBe("true");
    // First Escape closes the submenu; the second closes the root.
    act(() =>
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    );
    expect(anchor.getAttribute("aria-expanded")).toBe("true");
    act(() =>
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    );
    expect(row.hasAttribute("data-sidebar-menu-open")).toBe(false);
    expect(anchor.hasAttribute("data-sidebar-menu-open")).toBe(false);
    expect(anchor.hasAttribute("aria-expanded")).toBe(false);
    expect(anchor.hasAttribute("aria-haspopup")).toBe(false);
  });

  it("marks the overflow button on row right-click and clears it on unmount", async () => {
    const row = container.querySelector<HTMLElement>("[data-menu-item-id]")!;
    await act(async () =>
      popupSidebarMenu(
        {
          currentTarget: row,
          type: "contextmenu",
          clientX: 20,
          clientY: 40,
        } as unknown as React.MouseEvent,
        { source: "row", buildItems: () => [{ text: "Open" }] }
      )
    );
    expect(anchor.getAttribute("aria-expanded")).toBe("true");
    expect(row.getAttribute("data-sidebar-menu-open")).toBe("true");
    act(() => root.render(null));
    expect(anchor.hasAttribute("data-sidebar-menu-open")).toBe(false);
    expect(row.hasAttribute("data-sidebar-menu-open")).toBe(false);
  });
  it("renders token-sized icons on both submenu triggers and actions", async () => {
    await open([
      {
        text: "Open in",
        icon: CursorInWindowIcon,
        items: [{ text: "Copy", icon: Copy01Icon }],
      },
    ]);
    expect(menu()?.querySelector('[aria-haspopup="menu"] svg')).not.toBeNull();
    act(() => (document.activeElement as HTMLElement).click());
    const action = [...document.querySelectorAll('[role="menuitem"]')].find(
      (row) => row.textContent === "Copy"
    );
    expect(action?.querySelector("svg")).not.toBeNull();
  });

  it("disconnects late-content positioning observation when dismissed", async () => {
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe = observe;
        disconnect = disconnect;
      }
    );
    try {
      await open([{ text: "Open" }]);
      expect(observe).toHaveBeenCalledOnce();
      act(() => window.dispatchEvent(new Event("blur")));
      expect(disconnect).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("loads the native app destination only inside Open in and closes the whole menu on selection", async () => {
    const observed: Element[] = [];
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe(element: Element) {
          observed.push(element);
        }
        disconnect = disconnect;
      }
    );
    try {
      await open([
        {
          text: "Open in",
          appOpenSessionId: "session-a",
          items: [{ text: "New tab" }],
        },
      ]);
      expect(nativeAppMount).not.toHaveBeenCalled();
      expect(document.querySelector('[data-testid="native-app"]')).toBeNull();
      act(() => (document.activeElement as HTMLElement).click());
      const destination = document.querySelector<HTMLElement>(
        '[data-testid="native-app"]'
      )!;
      const flyout = destination.closest('[data-action-menu-submenu="true"]');
      expect(flyout).not.toBeNull();
      expect(flyout?.getAttribute("aria-label")).toBe("Open in");
      expect(nativeAppMount).toHaveBeenCalledWith("session-a");
      expect(observed).toContain(flyout);
      act(() => destination.click());
      expect(menu()).toBeNull();
      expect(disconnect).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("renders Export and Sync as inline sections in one submenu", async () => {
    const exportAction = vi.fn();
    await open([
      {
        text: "Export & sync",
        items: [
          {
            text: "Export",
            section: true,
            items: [{ text: "Markdown", action: exportAction }],
          },
          { item: "Separator" },
          { text: "Sync", section: true, items: [{ text: "Cloud sync" }] },
        ],
      },
    ]);
    act(() => (document.activeElement as HTMLElement).click());
    const flyout = document.querySelector('[data-action-menu-submenu="true"]')!;
    expect(
      [...flyout.querySelectorAll('[role="group"]')].map((group) =>
        group.getAttribute("aria-label")
      )
    ).toEqual(["Export", "Sync"]);
    expect(flyout.querySelector('[aria-haspopup="menu"]')).toBeNull();
    expect(flyout.querySelector('[role="separator"]')).not.toBeNull();
    expect(document.activeElement?.textContent).toBe("Markdown");
    act(() =>
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }))
    );
    expect(document.activeElement?.textContent).toBe("Cloud sync");
    act(() =>
      (flyout.querySelector('[role="menuitem"]') as HTMLElement).click()
    );
    expect(exportAction).toHaveBeenCalledOnce();
    expect(menu()).toBeNull();
  });
});
