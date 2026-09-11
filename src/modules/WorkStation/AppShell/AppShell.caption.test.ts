// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppType } from "@src/engines/Simulator/types/appTypes";
import { workstationActiveSessionIdAtom } from "@src/store/session";
import {
  simulatorCaptionBarEnabledAtom,
  simulatorEffectiveDockAppAtom,
} from "@src/store/ui/simulatorAtom";

import AppShell from "./index";

const { captionHook, frameSpy, station } = vi.hoisted(() => ({
  captionHook: vi.fn(),
  frameSpy: vi.fn(),
  station: { agent: true },
}));
vi.mock("@src/engines/Simulator/hooks/useCurrentTurnLastAgentMessage", () => ({
  useCurrentTurnLastAgentMessage: captionHook,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@src/hooks/ui/sidebar/useCollapsedSidebarChromeOffset", () => ({
  useCollapsedSidebarChromeOffset: () => 0,
  useShouldOffsetWorkStationTopBar: () => false,
}));
vi.mock("@src/hooks/ui/workbench/usePinnedWorkbenchChrome", () => ({
  usePinnedWorkbenchChromeVisible: () => false,
  useWorkbenchRightEdgeReservation: () => ({ owner: null, reservedRight: 0 }),
}));
vi.mock("../shared", () => ({
  SimulatorAgentChip: () => null,
  StationModeChip: () => null,
}));
vi.mock("@src/engines/Simulator/components/CaptionBar", () => ({
  default: ({ text }: { text: string }) =>
    createElement("span", { "data-caption": true }, text),
}));
vi.mock("./AgentStationChromeFrame", () => ({
  default: (props: { children: React.ReactNode; captionVisible: boolean }) => {
    frameSpy(props);
    return props.children;
  },
}));
vi.mock("./AppShellContent", () => ({ AppShellContent: () => null }));
vi.mock("./WorkstationTabBar", () => ({ default: () => null }));
vi.mock("./WorkstationTabHeader", () => ({ default: () => null }));
vi.mock("../shared/StatusBar/StatusBarRenderer", () => ({
  StatusBarRenderer: () => null,
}));
vi.mock("../shared/StatusBar/WorkspacePortScanner", () => ({
  WorkspacePortScanner: () => null,
}));
vi.mock("../shared/StatusBar/utils/useWorkspacePortAdvertisedUrls", () => ({
  useWorkspacePortAdvertisedUrls: () => undefined,
}));
vi.mock("@src/hooks/tabHost/useWorkStationPanels", () => ({
  useWorkStationPanels: () => ({ layoutMode: "left" }),
}));
vi.mock("./hooks/useAppShellActions", () => ({
  useAppShellActions: () => ({
    handleSelectRepo: vi.fn(),
    handleOpenSettings: vi.fn(),
  }),
}));
vi.mock("./hooks/useAppShellDerivedState", () => ({
  useAppShellDerivedState: () => ({
    activeHost: "code",
    isCodeMode: true,
    isBrowserMode: false,
    isProjectMode: false,
  }),
}));
vi.mock("./hooks/useAppShellDock", () => ({
  useAppShellDock: () => ({ visitedModes: new Set() }),
}));
vi.mock("./hooks/useAppShellRepo", () => ({
  useAppShellRepo: () => ({
    repoPath: "",
    repoName: "",
    pathExists: true,
    lastSeenPath: "",
  }),
}));
vi.mock("./hooks/useAppShellSimulatorPanelSync", () => ({
  useAppShellSimulatorPanelSync: () => undefined,
}));
vi.mock("./hooks/useAppShellStationMode", () => ({
  useAppShellStationMode: () => ({
    isAgentStation: station.agent,
    illuminateAgentStationChrome: false,
  }),
}));
vi.mock("./hooks/useAppShellStatusBar", () => ({
  useAppShellStatusBar: () => undefined,
}));
vi.mock("./hooks/useLaunchpadTab", () => ({
  useLaunchpadTab: () => undefined,
}));
vi.mock("./hooks/useTerminalTabTeardown", () => ({
  useTerminalTabTeardown: () => undefined,
}));
vi.mock("./hooks/useWorkstationRouteEntry", () => ({
  useWorkstationRouteEntry: () => undefined,
}));

describe("AppShell caption ownership", () => {
  beforeEach(() => {
    station.agent = true;
    captionHook.mockReset();
    frameSpy.mockClear();
  });
  function render(enabled: boolean, hasSession = true) {
    const store = createStore();
    store.set(simulatorCaptionBarEnabledAtom, enabled);
    store.set(
      workstationActiveSessionIdAtom,
      hasSession ? "caption-session" : null
    );
    store.set(simulatorEffectiveDockAppAtom, AppType.CHANNELS);
    return renderToStaticMarkup(
      createElement(
        Provider,
        { store },
        createElement(MemoryRouter, null, createElement(AppShell))
      )
    );
  }
  it.each([
    ["assistant", "message", "simulator.agentSentMessageCaption"],
    ["user", "message", "simulator.userSentMessageCaption"],
    ["assistant", "thought", "simulator.thoughtSentMessageCaption"],
  ])(
    "selects once and preserves %s/%s channel notices",
    (source, eventKind, expected) => {
      captionHook.mockReturnValue({
        text: "body",
        source,
        eventKind,
        eventId: "e",
        isCurrentEvent: true,
      });
      const markup = render(true);
      expect(captionHook).toHaveBeenCalledTimes(1);
      expect(markup).toContain(expected);
      expect(frameSpy.mock.calls[0][0].captionVisible).toBe(true);
    }
  );
  it.each([
    [false, true],
    [true, false],
  ])(
    "keeps frame and caption visibility aligned (%s/%s)",
    (enabled, hasSession) => {
      captionHook.mockReturnValue({
        text: "body",
        source: "assistant",
        eventKind: "message",
        eventId: "e",
        isCurrentEvent: false,
      });
      expect(render(enabled, hasSession)).not.toContain("data-caption");
      expect(frameSpy.mock.calls[0][0].captionVisible).toBe(false);
    }
  );
  it("handles no message and My Station without caption spacing", () => {
    captionHook.mockReturnValue(null);
    expect(render(true)).not.toContain("data-caption");
    expect(frameSpy.mock.calls[0][0].captionVisible).toBe(false);
    frameSpy.mockClear();
    station.agent = false;
    expect(render(true)).not.toContain("data-caption");
    expect(frameSpy.mock.calls[0][0].captionVisible).toBe(false);
  });
});
