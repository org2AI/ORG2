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
import { WorkStationViewService } from "@src/services/workStation/WorkStationViewService";
import { workstationActiveSessionIdAtom } from "@src/store/session/viewAtom";
import { chatPanelMaximizedAtom } from "@src/store/ui/chatPanel/surfaceAtoms";
import { activeStationChatVisibleAtom } from "@src/store/ui/chatPanel/visibilityAtoms";
import { chatWidthAtom } from "@src/store/ui/chatPanel/widthAtoms";
import { stationModeAtom } from "@src/store/ui/simulatorAtom";
import {
  createInstrumentedStore,
  resetInstrumentedStore,
} from "@src/util/core/state/instrumentedStore";

import AgentStationTopHeader from "./AgentStationTopHeader";

const { logError, stationWindowMock } = vi.hoisted(() => ({
  logError: vi.fn(),
  stationWindowMock: vi.fn(() => false),
}));
vi.mock("@src/hooks/logger", () => ({
  createLogger: () => ({ error: logError }),
}));
vi.mock("@src/util/platform/tauri/windowIdentity", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@src/util/platform/tauri/windowIdentity")
  >()),
  isStationWindow: stationWindowMock,
}));

// A full macOS host: `resolveHostDesktop` checks Windows / Linux before macOS,
// so mocking `isMacOS` alone still resolves to Linux on a Linux CI runner.
vi.mock("@src/util/platform/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@src/util/platform/tauri")>()),
  isMacOS: () => true,
  isLinux: () => false,
  isWindows: () => false,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@src/engines/Simulator/hooks/useCurrentTurnLastAgentMessage", () => ({
  useCurrentTurnLastAgentMessage: () => null,
}));
vi.mock("@src/hooks/ui/sidebar/useCollapsedSidebarChromeOffset", () => ({
  useCollapsedSidebarChromeOffset: () => 0,
  useShouldOffsetWorkStationTopBar: () => false,
}));
vi.mock("@src/services/workStation/WorkStationViewService", () => ({
  WorkStationViewService: { showWorkStation: vi.fn(async () => true) },
}));
vi.mock("@src/components/WindowChrome", () => ({
  NoDragRegion: ({ children }: { children: ReactNode }) =>
    createElement("div", null, children),
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
vi.mock("@src/modules/WorkStation/shared", () => ({
  SimulatorAgentChip: () => createElement("span"),
  StationModeChip: () => createElement("span"),
}));

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

describe("AgentStationTopHeader", () => {
  let container: HTMLDivElement;
  let root: Root;
  let store: ReturnType<typeof createInstrumentedStore>;

  beforeAll(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    stationWindowMock.mockReturnValue(false);
    resetInstrumentedStore();
    store = createInstrumentedStore();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    resetInstrumentedStore();
  });

  afterAll(() => {
    Reflect.deleteProperty(reactActEnvironment, "IS_REACT_ACT_ENVIRONMENT");
  });

  function renderHeader(path: string = ROUTES.workStation.base.path): void {
    act(() => {
      root.render(
        createElement(
          Provider,
          { store },
          createElement(
            MemoryRouter,
            { initialEntries: [path] },
            createElement(AgentStationTopHeader, {
              captionMessage: null,
              captionVisible: false,
            })
          )
        )
      );
    });
  }

  it("renders maximize and close controls when an agent session hides pinned chrome", () => {
    renderHeader();
    act(() => {
      store.set(stationModeAtom, "agent-station");
      store.set(workstationActiveSessionIdAtom, "session-a");
      store.set(activeStationChatVisibleAtom, "agent-station", true);
      store.set(chatWidthAtom, 360);
      store.set(chatPanelMaximizedAtom, false);
    });

    expect(
      container.querySelector('button[title="chat.maximizeWorkStation"]')
    ).not.toBeNull();
    expect(
      container.querySelector('button[title="chat.hideWorkstation"]')
    ).not.toBeNull();
  });

  it("renders one shrink control to restore chat and dispatches once", () => {
    renderHeader();
    act(() => {
      store.set(stationModeAtom, "agent-station");
      store.set(workstationActiveSessionIdAtom, "session-a");
      store.set(activeStationChatVisibleAtom, "agent-station", false);
    });
    const buttons = container.querySelectorAll<HTMLButtonElement>(
      'button[title="chat.restoreChatPanel"]'
    );
    expect(buttons).toHaveLength(1);
    expect(
      buttons[0].querySelector('[data-icon="arrow-shrink-02"]')
    ).not.toBeNull();
    vi.mocked(WorkStationViewService.showWorkStation).mockClear();
    act(() => buttons[0].click());
    expect(WorkStationViewService.showWorkStation).toHaveBeenCalledTimes(1);
  });

  it("handles a rejected visibility action without an unhandled rejection", async () => {
    renderHeader();
    act(() => {
      store.set(stationModeAtom, "agent-station");
      store.set(workstationActiveSessionIdAtom, "session-a");
      store.set(activeStationChatVisibleAtom, "agent-station", false);
    });
    const error = new Error("Station module failed to load");
    vi.mocked(WorkStationViewService.showWorkStation).mockRejectedValueOnce(
      error
    );
    const button = container.querySelector<HTMLButtonElement>(
      'button[title="chat.restoreChatPanel"]'
    );
    expect(button).not.toBeNull();
    await act(async () => button!.click());
    expect(logError).toHaveBeenCalledWith(
      "Failed to toggle station chat visibility:",
      error
    );
  });

  it("uses the same Settings pane action as My Station", () => {
    renderHeader(ROUTES.app.settings.path);
    const control = container.querySelector<HTMLButtonElement>(
      '[title="panel.maximizeSettings"]'
    );
    expect(control).not.toBeNull();
    expect(
      container.querySelector('[title="chat.maximizeWorkStation"]')
    ).toBeNull();
    expect(
      container.querySelector('[title="common:actions.openInNewWindow"]')
    ).toBeNull();
    act(() => store.set(chatPanelMaximizedAtom, false));
    act(() => control!.click());
    expect(store.get(chatPanelMaximizedAtom)).toBe(true);
  });

  it("offers to open Agent Station in a new window", () => {
    renderHeader();
    act(() => {
      store.set(stationModeAtom, "agent-station");
      store.set(workstationActiveSessionIdAtom, "session-a");
    });

    expect(
      container.querySelector('button[title="common:actions.openInNewWindow"]')
    ).not.toBeNull();
  });

  it("drops the pane controls and the detach button inside a station window", () => {
    stationWindowMock.mockReturnValue(true);
    renderHeader();
    act(() => {
      store.set(stationModeAtom, "agent-station");
      store.set(workstationActiveSessionIdAtom, "session-a");
      store.set(activeStationChatVisibleAtom, "agent-station", true);
      store.set(chatWidthAtom, 360);
      store.set(chatPanelMaximizedAtom, false);
    });

    expect(
      container.querySelector('button[title="common:actions.openInNewWindow"]')
    ).toBeNull();
    expect(
      container.querySelector('button[title="chat.maximizeWorkStation"]')
    ).toBeNull();
    expect(
      container.querySelector('button[title="chat.hideWorkstation"]')
    ).toBeNull();
    // The caption toggle is the station's own control and stays.
    expect(
      container.querySelector(
        'button[title="simulator.captionBarToggleTooltip"]'
      )
    ).not.toBeNull();
  });

  it("leaves the controls to pinned chrome while Agent Station is empty", () => {
    renderHeader();
    act(() => {
      store.set(stationModeAtom, "agent-station");
      store.set(activeStationChatVisibleAtom, "agent-station", true);
      store.set(chatWidthAtom, 360);
    });

    expect(
      container.querySelector('button[title="chat.maximizeWorkStation"]')
    ).toBeNull();
    expect(
      container.querySelector('button[title="chat.hideWorkstation"]')
    ).toBeNull();
  });
});
