import { createStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";

import { chatPanelMaximizedAtom } from "@src/store/ui/chatPanel/surfaceAtoms";
import { stationModeAtom } from "@src/store/ui/simulatorAtom";
import {
  type WorkStationTab,
  createProjectSettingsTab,
  createStartTab,
  workstationLayoutAtom,
} from "@src/store/workstation/tabs";

import {
  CLOSE_TAB_CHORD_FALLBACK,
  closeTabChordFallbackAtom,
  effectiveChatPanelMaximizedAtom,
} from "../chatPanelLayoutAtoms";
import { chatPanelTabsAtom } from "../chatPanelTabsState";

const { stationWindowMock } = vi.hoisted(() => ({
  stationWindowMock: vi.fn(() => false),
}));

vi.mock("@src/util/platform/tauri/windowIdentity", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@src/util/platform/tauri/windowIdentity")
  >()),
  isStationWindow: stationWindowMock,
}));

describe("effectiveChatPanelMaximizedAtom", () => {
  it("tracks active-tab policy without writing the user's split preference", () => {
    const store = createStore();
    store.set(chatPanelMaximizedAtom, false);
    const tabs = [
      { id: "session", type: "session" as const, title: "Session" },
      { id: "org", type: "organization" as const, title: "Organization" },
    ];
    store.set(chatPanelTabsAtom, { tabs, activeTabId: "session" });
    expect(store.get(effectiveChatPanelMaximizedAtom)).toBe(false);
    store.set(chatPanelTabsAtom, { tabs, activeTabId: "org" });
    expect(store.get(effectiveChatPanelMaximizedAtom)).toBe(true);
    expect(store.get(chatPanelMaximizedAtom)).toBe(false);
    store.set(chatPanelTabsAtom, { tabs, activeTabId: "session" });
    expect(store.get(effectiveChatPanelMaximizedAtom)).toBe(false);
    store.set(chatPanelMaximizedAtom, true);
    expect(store.get(effectiveChatPanelMaximizedAtom)).toBe(true);
  });
  it("isolates effective state per store", () => {
    const first = createStore();
    const second = createStore();
    first.set(chatPanelMaximizedAtom, true);
    second.set(chatPanelMaximizedAtom, false);
    expect(first.get(effectiveChatPanelMaximizedAtom)).toBe(true);
    expect(second.get(effectiveChatPanelMaximizedAtom)).toBe(false);
  });
});

it("does not notify layout consumers when a tab update keeps the same effective layout", () => {
  const store = createStore();
  const stopMount = store.sub(effectiveChatPanelMaximizedAtom, () => {});
  store.set(chatPanelTabsAtom, {
    activeTabId: "org",
    tabs: [{ id: "org", type: "organization", title: "Organization" }],
  });
  let notifications = 0;
  const unsubscribe = store.sub(effectiveChatPanelMaximizedAtom, () => {
    notifications += 1;
  });
  store.set(chatPanelTabsAtom, {
    activeTabId: "org",
    tabs: [{ id: "org", type: "organization", title: "Renamed organization" }],
  });
  store.set(chatPanelMaximizedAtom, true);
  expect(notifications).toBe(0);
  unsubscribe();
  stopMount();
});

describe("closeTabChordFallbackAtom", () => {
  const launchpadOnly = {
    tabs: [
      { id: "launchpad", type: "start-page" as const, title: "Launchpad" },
    ],
    activeTabId: "launchpad",
  };
  const withSession = {
    tabs: [{ id: "chat", type: "session" as const, title: "Session" }],
    activeTabId: "chat",
  };

  afterEach(() => {
    stationWindowMock.mockReturnValue(false);
  });

  function seed({
    chat = launchpadOnly,
    workstation = [createStartTab()],
    maximized = false,
    stationMode = "my-station",
  }: {
    chat?: typeof launchpadOnly | typeof withSession;
    workstation?: WorkStationTab[];
    maximized?: boolean;
    stationMode?: "my-station" | "agent-station";
  }) {
    const store = createStore();
    store.set(chatPanelTabsAtom, chat);
    store.set(workstationLayoutAtom, {
      mainPane: { tabs: workstation, activeTabId: workstation[0]?.id ?? null },
    });
    store.set(chatPanelMaximizedAtom, maximized);
    store.set(stationModeAtom, stationMode);
    return store.get(closeTabChordFallbackAtom);
  }

  it("closes My Station's Launchpad before the window", () => {
    expect(seed({})).toBe(CLOSE_TAB_CHORD_FALLBACK.CLOSE_STATION);
  });

  it("closes the Agent Station, which never holds a tab of its own", () => {
    expect(seed({ stationMode: "agent-station" })).toBe(
      CLOSE_TAB_CHORD_FALLBACK.CLOSE_STATION
    );
    expect(
      seed({
        stationMode: "agent-station",
        workstation: [createProjectSettingsTab()],
      })
    ).toBe(CLOSE_TAB_CHORD_FALLBACK.CLOSE_STATION);
    // Empty too: no session, no tabs behind it, still a Station on screen.
    expect(seed({ stationMode: "agent-station", workstation: [] })).toBe(
      CLOSE_TAB_CHORD_FALLBACK.CLOSE_STATION
    );
  });

  it("closes the window once My Station is closed too", () => {
    expect(seed({ maximized: true })).toBe(
      CLOSE_TAB_CHORD_FALLBACK.CLOSE_WINDOW
    );
    expect(
      seed({ workstation: [createProjectSettingsTab()], maximized: true })
    ).toBe(CLOSE_TAB_CHORD_FALLBACK.CLOSE_WINDOW);
    expect(seed({ stationMode: "agent-station", maximized: true })).toBe(
      CLOSE_TAB_CHORD_FALLBACK.CLOSE_WINDOW
    );
  });

  it("keeps closing tabs while the chat pane still holds one", () => {
    expect(seed({ chat: withSession })).toBeNull();
    expect(seed({ chat: withSession, maximized: true })).toBeNull();
  });

  it("keeps the chord as it was while an open station has more than a Launchpad", () => {
    expect(seed({ workstation: [createProjectSettingsTab()] })).toBeNull();
    expect(seed({ workstation: [] })).toBeNull();
  });

  it("closes a detached Station window that has nothing left to close", () => {
    stationWindowMock.mockReturnValue(true);
    expect(seed({})).toBe(CLOSE_TAB_CHORD_FALLBACK.CLOSE_WINDOW);
    expect(seed({ workstation: [createProjectSettingsTab()] })).toBeNull();
    expect(seed({ stationMode: "agent-station" })).toBe(
      CLOSE_TAB_CHORD_FALLBACK.CLOSE_WINDOW
    );
  });
});
