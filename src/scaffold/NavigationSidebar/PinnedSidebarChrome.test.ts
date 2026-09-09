// @vitest-environment jsdom
import { Provider } from "jotai";
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { hoverSidebarOpenAtom } from "@src/store/ui/hoverSidebarAtom";
import { sidebarCollapsedAtom } from "@src/store/ui/sidebarAtom";
import { windowFullscreenAtom } from "@src/store/ui/uiAtom";
import {
  createInstrumentedStore,
  resetInstrumentedStore,
} from "@src/util/core/state/instrumentedStore";

import { PinnedSidebarChrome } from "./PinnedSidebarChrome";

const { hasMacWindowChromeMock } = vi.hoisted(() => ({
  hasMacWindowChromeMock: vi.fn(),
}));

vi.mock("@src/config/windowChromeRadius", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@src/config/windowChromeRadius")>()),
  hasMacWindowChrome: hasMacWindowChromeMock,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

describe("PinnedSidebarChrome", () => {
  let container: HTMLDivElement;
  let root: Root;
  let store: ReturnType<typeof createInstrumentedStore>;

  beforeAll(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    hasMacWindowChromeMock.mockReturnValue(true);
    resetInstrumentedStore();
    localStorage.clear();
    store = createInstrumentedStore();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    resetInstrumentedStore();
    hasMacWindowChromeMock.mockReset();
  });

  afterAll(() => {
    Reflect.deleteProperty(reactActEnvironment, "IS_REACT_ACT_ENVIRONMENT");
  });

  function render(): void {
    act(() => {
      root.render(
        createElement(Provider, { store }, createElement(PinnedSidebarChrome))
      );
    });
  }

  function query(testId: string): HTMLElement | null {
    return container.querySelector(`[data-testid="${testId}"]`);
  }

  function click(testId: string): void {
    const element = query(testId);
    if (!(element instanceof HTMLElement)) {
      throw new Error(`${testId} did not render`);
    }
    act(() => element.click());
  }

  it("renders nothing outside a macOS window (other hosts, browser mode)", () => {
    hasMacWindowChromeMock.mockReturnValue(false);
    render();
    expect(query("pinned-sidebar-chrome")).toBeNull();
  });

  it("pins the arrows and the hide toggle at the traffic-light offset", () => {
    act(() => store.set(sidebarCollapsedAtom, false));
    render();

    const group = query("pinned-sidebar-chrome");
    expect(group).not.toBeNull();
    expect(group?.style.left).toBe("88px");
    expect(group?.style.top).toBe("26px");
    expect(query("session-history-nav")).not.toBeNull();
    expect(query("sidebar-chrome-hide")).not.toBeNull();

    // Sidebar open: sidebar tokens, toggle first, then Back / Forward, 1px apart.
    expect(group?.getAttribute("data-variant")).toBe("sidebar");
    expect(group?.className).toContain("gap-px");
    const order = Array.from(
      group?.querySelectorAll("button[data-testid]") ?? []
    ).map((element) => element.getAttribute("data-testid"));
    expect(order).toEqual([
      "sidebar-chrome-hide",
      "session-history-nav-back",
      "session-history-nav-forward",
    ]);

    click("sidebar-chrome-hide");
    expect(store.get(sidebarCollapsedAtom)).toBe(true);
    expect(query("sidebar-chrome-show")).not.toBeNull();
    expect(group?.style.left).toBe("88px");
    // Collapsed: the chat pane is underneath, so its tokens take over.
    expect(group?.getAttribute("data-variant")).toBe("chat");
  });

  it("slides to the window edge in native full screen, where no traffic lights are drawn", () => {
    act(() => store.set(sidebarCollapsedAtom, false));
    render();

    const group = query("pinned-sidebar-chrome");
    expect(group?.style.left).toBe("88px");

    act(() => store.set(windowFullscreenAtom, true));
    expect(group?.style.left).toBe("16px");
    expect(group?.style.top).toBe("26px");

    act(() => store.set(windowFullscreenAtom, false));
    expect(group?.style.left).toBe("88px");
  });

  it("previews the collapsed sidebar on hover and expands it on click", () => {
    act(() => store.set(sidebarCollapsedAtom, true));
    render();

    act(() => {
      query("sidebar-chrome-show")?.dispatchEvent(
        new MouseEvent("mouseover", { bubbles: true })
      );
    });

    expect(store.get(hoverSidebarOpenAtom)).toBe(true);
    expect(store.get(sidebarCollapsedAtom)).toBe(true);
    expect(query("sidebar-chrome-expand")).not.toBeNull();
    click("sidebar-chrome-expand");
    expect(store.get(hoverSidebarOpenAtom)).toBe(false);
    expect(store.get(sidebarCollapsedAtom)).toBe(false);
  });

  it("does not preview the sidebar when hovering its hide button", () => {
    act(() => store.set(sidebarCollapsedAtom, false));
    render();

    act(() => {
      query("sidebar-chrome-hide")?.dispatchEvent(
        new MouseEvent("mouseover", { bubbles: true })
      );
    });

    expect(store.get(hoverSidebarOpenAtom)).toBe(false);
    expect(store.get(sidebarCollapsedAtom)).toBe(false);
  });

  it("offers expand without a close button while the hover sidebar is open", () => {
    act(() => {
      store.set(sidebarCollapsedAtom, true);
      store.set(hoverSidebarOpenAtom, true);
    });
    render();

    expect(query("sidebar-chrome-expand")).not.toBeNull();
    expect(query("pinned-sidebar-chrome")?.getAttribute("data-variant")).toBe(
      "sidebar"
    );
    expect(query("sidebar-chrome-close-hover")).toBeNull();
    click("sidebar-chrome-expand");
    expect(store.get(hoverSidebarOpenAtom)).toBe(false);
    expect(store.get(sidebarCollapsedAtom)).toBe(false);
  });
});
