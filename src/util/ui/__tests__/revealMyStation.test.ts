// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ROUTES } from "@src/config/routes";
import {
  createLaunchpadTab,
  createRuntimeTab,
  createSessionTab,
} from "@src/store/chatPanel/chatPanelTabFactories";
import { chatPanelTabsAtom } from "@src/store/chatPanel/chatPanelTabsState";
import { chatPanelMaximizedAtom } from "@src/store/ui/chatPanel/surfaceAtoms";
import { stationModeAtom } from "@src/store/ui/simulatorAtom";
import {
  createInstrumentedStore,
  resetInstrumentedStore,
} from "@src/util/core/state/instrumentedStore";

import { revealMyStation } from "../revealMyStation";

const navigated: string[] = [];

function recordNavigation(event: Event): void {
  navigated.push((event as CustomEvent<{ path: string }>).detail.path);
}

function goTo(pathname: string): void {
  window.history.replaceState({}, "", pathname);
}

beforeEach(() => {
  navigated.length = 0;
  localStorage.clear();
  resetInstrumentedStore();
  window.addEventListener("action-system-navigate", recordNavigation);
});

afterEach(() => {
  window.removeEventListener("action-system-navigate", recordNavigation);
  vi.unstubAllGlobals();
});

describe("revealMyStation", () => {
  it("does nothing when no app store exists yet", () => {
    expect(() => revealMyStation()).not.toThrow();
    expect(navigated).toEqual([]);
  });

  it("switches to My Station and un-maximizes the chat-panel slot", () => {
    const store = createInstrumentedStore();
    goTo(ROUTES.workStation.code.path);
    store.set(stationModeAtom, "agent-station");
    store.set(chatPanelMaximizedAtom, true);

    revealMyStation({ path: ROUTES.workStation.browser.path });

    expect(store.get(stationModeAtom)).toBe("my-station");
    expect(store.get(chatPanelMaximizedAtom)).toBe(false);
    // Already on a workbench route: the Station is exposed in place.
    expect(navigated).toEqual([]);
  });

  it("leaves a chat tab the Station may not share the workbench with", () => {
    const store = createInstrumentedStore();
    goTo(ROUTES.workStation.code.path);
    const runtime = createRuntimeTab({});
    const session = createSessionTab({ sessionId: "session-1" });
    store.set(chatPanelTabsAtom, {
      tabs: [runtime, session],
      activeTabId: runtime.id,
    });

    revealMyStation();

    expect(store.get(chatPanelTabsAtom).activeTabId).toBe(session.id);
  });

  it("falls back to the Launchpad when no open chat tab allows the Station", () => {
    const store = createInstrumentedStore();
    goTo(ROUTES.workStation.code.path);
    const runtime = createRuntimeTab({});
    store.set(chatPanelTabsAtom, {
      tabs: [runtime],
      activeTabId: runtime.id,
    });

    revealMyStation();

    const { tabs, activeTabId } = store.get(chatPanelTabsAtom);
    expect(tabs.find((tab) => tab.id === activeTabId)?.type).toBe("start-page");
  });

  it("keeps a chat tab that already allows the Station", () => {
    const store = createInstrumentedStore();
    goTo(ROUTES.workStation.code.path);
    const launchpad = createLaunchpadTab({});
    store.set(chatPanelTabsAtom, {
      tabs: [launchpad],
      activeTabId: launchpad.id,
    });

    revealMyStation();

    expect(store.get(chatPanelTabsAtom).activeTabId).toBe(launchpad.id);
  });

  it("navigates to the requested surface from a route with no Station", () => {
    createInstrumentedStore();
    goTo("/orgii/mobile");

    revealMyStation({ path: ROUTES.workStation.browser.path });

    expect(navigated).toEqual([ROUTES.workStation.browser.path]);
  });
});
