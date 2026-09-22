// @vitest-environment jsdom
import { Provider } from "jotai";
import { type ReactNode, act, createElement } from "react";
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
import { activeStationChatVisibleAtom } from "@src/store/ui/chatPanel/visibilityAtoms";
import { workstationProjectTabBarAtom } from "@src/store/workstation";
import {
  type WorkstationTabHost,
  tabTypeToTabHost,
} from "@src/store/workstation/tabHost";
import type { WorkStationTabType } from "@src/store/workstation/tabs/types";
import {
  createInstrumentedStore,
  resetInstrumentedStore,
} from "@src/util/core/state/instrumentedStore";

import { useWorkstationTrailingSlot } from "./useWorkstationTrailingSlot";

const { pinnedChromeVisibleMock, stationWindowMock } = vi.hoisted(() => ({
  pinnedChromeVisibleMock: vi.fn(),
  stationWindowMock: vi.fn(() => false),
}));

vi.mock("@src/hooks/ui/workbench/usePinnedWorkbenchChrome", () => ({
  usePinnedWorkbenchChromeVisible: pinnedChromeVisibleMock,
}));
vi.mock("@src/util/platform/tauri/windowIdentity", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@src/util/platform/tauri/windowIdentity")
  >()),
  isStationWindow: stationWindowMock,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@src/services/workStation/WorkStationViewService", () => ({
  WorkStationViewService: { showWorkStation: vi.fn(async () => true) },
}));
vi.mock("@src/components/TabPill/TabBarTrailingIconButton", () => ({
  TabBarTrailingIconButton: ({
    children,
    onClick,
    title,
  }: {
    children: ReactNode;
    onClick?: () => void;
    title: string;
  }) => createElement("button", { onClick, title }, children),
}));
vi.mock("@src/scaffold/WorkbenchChrome/TabBarPlusMenu", () => ({
  TabBarPlusMenu: () => createElement("button", { title: "new-tab" }),
}));
vi.mock(
  "@src/modules/ProjectManager/ProjectManagerLayout/components/ProjectManagerWorkItemsTabBarTrailing",
  () => ({ default: () => createElement("span", { title: "project-actions" }) })
);

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

function TrailingSlotHarness({ host }: { host: WorkstationTabHost }) {
  const { trailingSlot } = useWorkstationTrailingSlot({ host, visible: [] });
  return createElement("div", null, trailingSlot);
}

describe("useWorkstationTrailingSlot pane controls", () => {
  let container: HTMLDivElement;
  let root: Root;
  let store: ReturnType<typeof createInstrumentedStore>;

  beforeAll(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    pinnedChromeVisibleMock.mockReturnValue(false);
    stationWindowMock.mockReturnValue(false);
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
    pinnedChromeVisibleMock.mockReset();
  });

  afterAll(() => {
    Reflect.deleteProperty(reactActEnvironment, "IS_REACT_ACT_ENVIRONMENT");
  });

  function renderHost(
    host: WorkstationTabHost,
    path: string = ROUTES.workStation.base.path
  ): void {
    act(() => {
      root.render(
        createElement(
          Provider,
          { store },
          createElement(
            MemoryRouter,
            { initialEntries: [path] },
            createElement(TrailingSlotHarness, { host })
          )
        )
      );
    });
  }

  function expectPaneControls(): void {
    expect(
      container.querySelector('button[title="chat.maximizeWorkStation"]')
    ).not.toBeNull();
    expect(
      container.querySelector('button[title="chat.hideWorkstation"]')
    ).not.toBeNull();
  }

  it.each<WorkStationTabType>([
    "file",
    "browser-session",
    "project-dashboard",
    "project-work-items",
    "workItem-detail",
  ])("keeps maximize and close available for populated %s tabs", (tabType) => {
    renderHost(tabTypeToTabHost(tabType));

    expectPaneControls();
  });

  it("leaves empty My Station controls to the pinned window chrome", () => {
    pinnedChromeVisibleMock.mockReturnValue(true);
    renderHost("code");

    expect(
      container.querySelector('button[title="chat.maximizeWorkStation"]')
    ).toBeNull();
    expect(
      container.querySelector('button[title="chat.hideWorkstation"]')
    ).toBeNull();
  });

  it("offers to open My Station in a new window beside the pane controls", () => {
    renderHost("code");

    expect(
      container.querySelector(
        '[data-testid="my-station-open-in-new-window"], button[title="common:actions.openInNewWindow"]'
      )
    ).not.toBeNull();
  });

  it("uses the Settings pane action without chat or detach controls", () => {
    renderHost("code", ROUTES.app.settings.path);
    expect(
      container.querySelector('[title="panel.maximizeSettings"]')
    ).not.toBeNull();
    expect(
      container.querySelector('[title="chat.maximizeWorkStation"]')
    ).toBeNull();
    expect(
      container.querySelector('[title="common:actions.openInNewWindow"]')
    ).toBeNull();
  });

  it("drops the pane controls and the detach button inside a station window", () => {
    stationWindowMock.mockReturnValue(true);
    renderHost("code");

    expect(container.querySelector('[title="new-tab"]')).not.toBeNull();
    expect(
      container.querySelector('button[title="common:actions.openInNewWindow"]')
    ).toBeNull();
    expect(
      container.querySelector('button[title="chat.maximizeWorkStation"]')
    ).toBeNull();
    expect(
      container.querySelector('button[title="chat.hideWorkstation"]')
    ).toBeNull();
    expect(
      container.querySelector('button[title="chat.restoreChatPanel"]')
    ).toBeNull();
  });

  it("preserves project-specific trailing actions beside shared pane controls", () => {
    store.set(workstationProjectTabBarAtom, { onAddProject: vi.fn() });
    renderHost("project");

    expect(container.querySelector('[title="project-actions"]')).not.toBeNull();
    expectPaneControls();
  });

  it("keeps exactly one shrink action to restore chat across tab hosts", () => {
    renderHost("code");
    act(() => {
      store.set(activeStationChatVisibleAtom, "my-station", false);
    });
    for (const host of ["code", "browser", "project"] as const) {
      renderHost(host);
      const restoreButtons = container.querySelectorAll(
        'button[title="chat.restoreChatPanel"]'
      );
      expect(restoreButtons).toHaveLength(1);
      expect(
        restoreButtons[0].querySelector('[data-icon="arrow-shrink-02"]')
      ).not.toBeNull();
      expect(
        container.querySelector('[data-icon="message-circle"]')
      ).toBeNull();
      expect(
        container.querySelectorAll('button[title="chat.hideWorkstation"]')
      ).toHaveLength(1);
    }
  });

  it("keeps the same four station controls together at the trailing edge across tab switches", () => {
    store.set(workstationProjectTabBarAtom, { onAddProject: vi.fn() });
    renderHost("code");

    const stationControls = Array.from(container.querySelectorAll("button"));
    expect(stationControls.map((control) => control.title)).toEqual([
      "new-tab",
      "common:actions.openInNewWindow",
      "chat.maximizeWorkStation",
      "chat.hideWorkstation",
    ]);

    for (const host of ["project", "browser", "code"] as const) {
      renderHost(host);

      const controls = Array.from(container.firstElementChild!.children);
      expect(controls.slice(-4)).toEqual(stationControls);
      controls.slice(-4).forEach((control, index) => {
        expect(control).toBe(stationControls[index]);
      });
      if (host === "project") {
        expect(controls[0].getAttribute("title")).toBe("project-actions");
      }
    }
  });
});
