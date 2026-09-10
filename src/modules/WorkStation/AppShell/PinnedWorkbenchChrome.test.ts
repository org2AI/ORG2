// @vitest-environment jsdom
import { Provider } from "jotai";
import { Fragment, act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
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

import { ROUTES } from "@src/config/routes";
import {
  getPinnedWorkbenchChromeReservedRight,
  isPinnedWorkbenchChromePath,
  resolvePinnedWorkbenchChromeSlots,
  shouldShowPinnedWorkbenchChrome,
  useWorkbenchRightEdgeReservation,
} from "@src/hooks/ui/workbench/usePinnedWorkbenchChrome";
import { chatPanelTabsAtom } from "@src/store/chatPanel/chatPanelTabsState";
import { workstationActiveSessionIdAtom } from "@src/store/session/viewAtom";
import { settingsAtom } from "@src/store/settings";
import { chatPanelMaximizedAtom } from "@src/store/ui/chatPanel/surfaceAtoms";
import { activeStationChatVisibleAtom } from "@src/store/ui/chatPanel/visibilityAtoms";
import { chatWidthAtom } from "@src/store/ui/chatPanel/widthAtoms";
import { stationModeAtom } from "@src/store/ui/simulatorAtom";
import { workstationLayoutAtom } from "@src/store/workstation/tabs";
import { createFileTab } from "@src/store/workstation/tabs/factories";
import {
  createInstrumentedStore,
  resetInstrumentedStore,
} from "@src/util/core/state/instrumentedStore";

import { PinnedWorkbenchChrome } from "./PinnedWorkbenchChrome";

const { isMacOSMock } = vi.hoisted(() => ({ isMacOSMock: vi.fn() }));

vi.mock("@src/util/platform/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@src/util/platform/tauri")>()),
  isMacOS: isMacOSMock,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@src/services/workStation/WorkStationViewService", () => ({
  WorkStationViewService: { showWorkStation: vi.fn(async () => true) },
}));

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

function RightEdgeReservationProbe() {
  const reservation = useWorkbenchRightEdgeReservation();
  return createElement("div", {
    "data-testid": "right-edge-reservation",
    "data-owner": reservation.owner,
    "data-reserved-right": reservation.reservedRight,
  });
}

describe("PinnedWorkbenchChrome", () => {
  let container: HTMLDivElement;
  let root: Root;
  let store: ReturnType<typeof createInstrumentedStore>;

  beforeAll(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    isMacOSMock.mockReturnValue(true);
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
    isMacOSMock.mockReset();
  });

  afterAll(() => {
    Reflect.deleteProperty(reactActEnvironment, "IS_REACT_ACT_ENVIRONMENT");
  });

  function render(pathname = ROUTES.workStation.base.path): void {
    act(() => {
      root.render(
        createElement(
          Provider,
          { store },
          createElement(
            MemoryRouter,
            { initialEntries: [pathname] },
            createElement(
              Fragment,
              null,
              createElement(PinnedWorkbenchChrome),
              createElement(RightEdgeReservationProbe)
            )
          )
        )
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

  it("renders nothing off macOS or on the Settings route", () => {
    isMacOSMock.mockReturnValue(false);
    render();
    expect(query("pinned-workbench-chrome")).toBeNull();

    isMacOSMock.mockReturnValue(true);
    render(ROUTES.app.settings.path);
    expect(query("pinned-workbench-chrome")).toBeNull();
    expect(isPinnedWorkbenchChromePath(ROUTES.app.settings.path)).toBe(false);
    expect(isPinnedWorkbenchChromePath(ROUTES.workStation.base.path)).toBe(
      true
    );
  });

  it("leaves populated station headers clear for their own trailing controls", () => {
    expect(
      shouldShowPinnedWorkbenchChrome({
        baseVisible: true,
        stationMode: "my-station",
        myStationHasContent: true,
        agentStationHasContent: false,
      })
    ).toBe(false);
    expect(
      shouldShowPinnedWorkbenchChrome({
        baseVisible: true,
        stationMode: "agent-station",
        myStationHasContent: false,
        agentStationHasContent: true,
      })
    ).toBe(false);

    expect(
      shouldShowPinnedWorkbenchChrome({
        baseVisible: true,
        stationMode: "my-station",
        myStationHasContent: false,
        agentStationHasContent: true,
      })
    ).toBe(true);
    expect(
      shouldShowPinnedWorkbenchChrome({
        baseVisible: true,
        stationMode: "agent-station",
        myStationHasContent: true,
        agentStationHasContent: false,
      })
    ).toBe(true);
  });

  it("removes the pinned group when the active station gains content", () => {
    render();
    expect(query("pinned-workbench-chrome")).not.toBeNull();

    const fileTab = createFileTab("/repo/src/index.ts");
    act(() => {
      store.set(workstationLayoutAtom, {
        mainPane: { tabs: [fileTab], activeTabId: fileTab.id },
      });
    });
    expect(query("pinned-workbench-chrome")).toBeNull();

    act(() => {
      store.set(stationModeAtom, "agent-station");
    });
    expect(query("pinned-workbench-chrome")).not.toBeNull();

    act(() => {
      store.set(workstationActiveSessionIdAtom, "session-a");
    });
    expect(query("pinned-workbench-chrome")).toBeNull();
  });

  it("pins hide-chat and maximize-chat at the window's right edge, 1px apart", () => {
    render();
    act(() => {
      store.set(activeStationChatVisibleAtom, "my-station", true);
      store.set(chatWidthAtom, 360);
      store.set(chatPanelMaximizedAtom, false);
    });

    const group = query("pinned-workbench-chrome");
    expect(group?.style.right).toBe("8px");
    expect(group?.style.top).toBe("26px");
    expect(group?.className).toContain("gap-px");
    expect(query("pinned-workbench-chrome-chat-visibility")).not.toBeNull();
    expect(query("pinned-workbench-chrome-maximize-chat")).not.toBeNull();

    click("pinned-workbench-chrome-maximize-chat");
    expect(store.get(chatPanelMaximizedAtom)).toBe(true);
    expect(query("pinned-workbench-chrome-show-workstation")).not.toBeNull();
    expect(group?.style.right).toBe("8px");
    // Maximized: the hide-chat slot is gone outright, no spacer left behind.
    expect(query("pinned-workbench-chrome-chat-visibility")).toBeNull();
    expect(group?.childElementCount).toBe(1);
  });

  it("draws only the restore toggle, flush right, while the chat is hidden", () => {
    render();
    act(() => {
      store.set(activeStationChatVisibleAtom, "my-station", false);
      store.set(chatPanelMaximizedAtom, false);
    });

    expect(query("pinned-workbench-chrome-chat-visibility")).not.toBeNull();
    expect(query("pinned-workbench-chrome-maximize-chat")).toBeNull();
    expect(query("pinned-workbench-chrome")?.childElementCount).toBe(1);
  });

  it.each(["organization", "team-inbox", "work-management"] as const)(
    "reserves one disabled sidebar control for full-width %s tabs with a saved split layout",
    (type) => {
      render();
      act(() => {
        store.set(activeStationChatVisibleAtom, "my-station", true);
        store.set(chatWidthAtom, 360);
        store.set(settingsAtom, {
          ...store.get(settingsAtom),
          "general.chatPanelPosition": "left",
        });
        store.set(chatPanelMaximizedAtom, false);
        store.set(chatPanelTabsAtom, {
          activeTabId: "full-width-tab",
          tabs: [{ id: "full-width-tab", type, title: "Full-width page" }],
        });
      });

      expect(query("pinned-workbench-chrome-chat-visibility")).toBeNull();
      expect(query("pinned-workbench-chrome-maximize-chat")).toBeNull();
      const sidebarButton = query("pinned-workbench-chrome-show-workstation");
      expect(sidebarButton).toBeInstanceOf(HTMLButtonElement);
      expect((sidebarButton as HTMLButtonElement).disabled).toBe(true);
      expect(query("pinned-workbench-chrome")?.childElementCount).toBe(1);
      expect(query("right-edge-reservation")?.dataset.owner).toBe("chat");
      expect(query("right-edge-reservation")?.dataset.reservedRight).toBe(
        String(getPinnedWorkbenchChromeReservedRight(1))
      );
      click("pinned-workbench-chrome-show-workstation");
      expect(store.get(chatPanelMaximizedAtom)).toBe(false);
    }
  );

  it("follows the station on screen: Agent Station keeps its maximize toggle", () => {
    render();
    act(() => {
      // My Station's chat is hidden; Agent Station's is showing.
      store.set(activeStationChatVisibleAtom, "my-station", false);
      store.set(stationModeAtom, "agent-station");
      store.set(activeStationChatVisibleAtom, "agent-station", true);
      store.set(chatPanelMaximizedAtom, false);
    });

    expect(query("pinned-workbench-chrome-chat-visibility")).not.toBeNull();
    expect(query("pinned-workbench-chrome-maximize-chat")).not.toBeNull();
    expect(query("pinned-workbench-chrome")?.childElementCount).toBe(2);
  });

  it("reserves inset, the visible slots, and gaps for hosts", () => {
    expect(getPinnedWorkbenchChromeReservedRight(2)).toBe(8 + 28 + 1 + 28 + 1);
    expect(getPinnedWorkbenchChromeReservedRight(1)).toBe(8 + 28 + 1);
    expect(
      resolvePinnedWorkbenchChromeSlots({
        chatVisible: true,
        chatPanelMaximized: false,
      })
    ).toBe(2);
    expect(
      resolvePinnedWorkbenchChromeSlots({
        chatVisible: true,
        chatPanelMaximized: true,
      })
    ).toBe(1);
    expect(
      resolvePinnedWorkbenchChromeSlots({
        chatVisible: false,
        chatPanelMaximized: false,
      })
    ).toBe(1);
  });
});
