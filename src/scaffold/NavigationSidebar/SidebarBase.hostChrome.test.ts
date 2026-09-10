// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
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

import type { SidebarBaseProps } from "./types";

const { resolveHostDesktopMock } = vi.hoisted(() => ({
  resolveHostDesktopMock: vi.fn<() => "macos" | "windows" | "linux">(),
}));

vi.mock("@src/config/windowChromeRadius", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@src/config/windowChromeRadius")>();
  return {
    ...actual,
    resolveHostDesktop: resolveHostDesktopMock,
    hasMacWindowChrome: () => resolveHostDesktopMock() === "macos",
  };
});
vi.mock("@src/hooks/settings/useSettings", () => ({
  useSettingValue: (key: string) => {
    if (key === "layout.sidebarSelectedRowOpacity") return 100;
    if (key === "layout.sidebarEdgeDepthEnabled") return false;
    if (key === "general.translucentSidebar") return true;
    return undefined;
  },
}));
vi.mock("@src/hooks/ui/sidebar/useSidebarState", () => ({
  useSidebarState: () => ({
    width: 260,
    expandedWidth: 260,
    isCollapsed: false,
    isDragging: false,
    handleMouseDown: () => undefined,
    toggleCollapse: () => undefined,
    expand: () => undefined,
    collapse: () => undefined,
    setWidth: () => undefined,
  }),
}));
vi.mock("@src/scaffold/Resize", () => ({
  VerticalResizeHandle: () => null,
}));
vi.mock("@src/util/platform/tauri/nativeMenuPopup", () => ({
  popupNativeMenu: async () => undefined,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

type SidebarBaseModule = typeof import("./SidebarBase");
type UiAtomModule = typeof import("@src/store/ui/uiAtom");

describe("SidebarBase host chrome row", () => {
  let container: HTMLDivElement;
  let root: Root;
  let store: ReturnType<typeof createStore>;

  beforeAll(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    // `SidebarBase` resolves the host once at module scope.
    vi.resetModules();
    store = createStore();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    resolveHostDesktopMock.mockReset();
  });

  afterAll(() => {
    Reflect.deleteProperty(reactActEnvironment, "IS_REACT_ACT_ENVIRONMENT");
  });

  async function renderHost(
    host: "macos" | "windows" | "linux"
  ): Promise<UiAtomModule> {
    resolveHostDesktopMock.mockReturnValue(host);
    const [{ default: SidebarBase }, uiAtoms] = await Promise.all([
      import("./SidebarBase") as Promise<SidebarBaseModule>,
      import("@src/store/ui/uiAtom") as Promise<UiAtomModule>,
    ]);
    // `SidebarBaseProps` requires `children`, so it rides in the props object.
    const props: SidebarBaseProps = {
      onAddNew: () => undefined,
      addLabel: "Add",
      topBarFollowingContent: createElement("div", {
        "data-testid": "follow-content",
      }),
      children: createElement("div", { "data-testid": "sidebar-body" }),
    };
    await act(async () => {
      root.render(
        createElement(Provider, { store }, createElement(SidebarBase, props))
      );
    });
    return uiAtoms;
  }

  function query(testId: string): HTMLElement | null {
    return container.querySelector(`[data-testid="${testId}"]`);
  }

  it.each(["windows", "linux"] as const)(
    "%s: leads the chrome row with the toggle group and gives the follow content its own row",
    async (host) => {
      await renderHost(host);

      const row = query("sidebar-chrome-row");
      expect(row).not.toBeNull();
      // No traffic lights to reserve: the class inset (8px, matching the
      // collapsed-sidebar hosts) wins, and nothing inline overrides it.
      expect(row?.style.paddingLeft).toBe("");
      expect(row?.className).toContain("pl-2");

      const leading = query("sidebar-chrome-leading-group");
      expect(leading).not.toBeNull();
      expect(row?.firstElementChild).toBe(leading);
      const order = Array.from(
        leading?.querySelectorAll("button[data-testid]") ?? []
      ).map((element) => element.getAttribute("data-testid"));
      expect(order).toEqual([
        "sidebar-chrome-hide",
        "session-history-nav-back",
        "session-history-nav-forward",
      ]);
      expect(
        leading?.querySelector("[data-variant]")?.getAttribute("data-variant")
      ).toBe("sidebar");

      // Add-new stays at the right edge of the same row.
      expect(row?.querySelector('button[aria-label="Add"]')).not.toBeNull();
      expect(row?.textContent).not.toContain("ORG2");

      // The org selector / settings return item is the next row, not a
      // co-tenant of the chrome row.
      const follow = query("follow-content");
      expect(follow).not.toBeNull();
      expect(row?.contains(follow)).toBe(false);
      expect(row?.nextElementSibling).toBe(follow);
    }
  );

  it("macos: reserves the pinned group and traffic lights instead of drawing the group in flow", async () => {
    const { windowFullscreenAtom } = await renderHost("macos");

    const row = query("sidebar-chrome-row");
    expect(row).not.toBeNull();
    expect(query("sidebar-chrome-leading-group")).toBeNull();
    expect(query("sidebar-chrome-hide")).toBeNull();
    // 80px traffic lights + 8px inset + 57px Back / Forward + 30px toggle.
    expect(row?.style.paddingLeft).toBe("176px");
    expect(row?.nextElementSibling).toBe(query("follow-content"));

    // Native full screen hides the traffic lights: an 8px edge inset plus
    // the pinned group's footprint remains reserved.
    act(() => store.set(windowFullscreenAtom, true));
    expect(row?.style.paddingLeft).toBe("104px");
  });
});
