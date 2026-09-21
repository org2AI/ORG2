import { createStore } from "jotai";
import { describe, expect, it } from "vitest";

import { chatPanelMaximizedAtom } from "@src/store/ui/chatPanel/surfaceAtoms";

import {
  effectiveChatPanelMaximizedAtom,
  toggleActiveChatPanelMaximizedAtom,
} from "../chatPanelLayoutAtoms";
import {
  type ChatPanelTabType,
  isChatPanelTabStationAvailable,
  isStandaloneChatPanelToolTab,
  resolveChatPanelMaximizedForLayout,
} from "../chatPanelTabsModel";
import { chatPanelTabsAtom } from "../chatPanelTabsState";

const STATION_TAB_TYPES: ChatPanelTabType[] = [
  "session",
  "terminal",
  "start-page",
  "channel",
  "run-group",
];

const FULL_WORKBENCH_TAB_TYPES: ChatPanelTabType[] = [
  "runtime",
  "work-management",
  "workspace",
  "organization",
  "work-item",
  "github-issue",
  "github-pr",
  "project",
  "explore",
];

function storeWithActiveTab(type: ChatPanelTabType, maximized: boolean) {
  const store = createStore();
  store.set(chatPanelMaximizedAtom, maximized);
  store.set(chatPanelTabsAtom, {
    activeTabId: "selected",
    tabs: [{ id: "selected", type, title: "Selected tab" }],
  });
  return store;
}

describe("Chat Panel tab Station access", () => {
  it.each(STATION_TAB_TYPES)(
    "keeps Station access and the pane toggle available for %s tabs",
    (type) => {
      expect(isChatPanelTabStationAvailable(type)).toBe(true);
      for (const maximized of [false, true]) {
        const store = storeWithActiveTab(type, maximized);
        expect(store.get(effectiveChatPanelMaximizedAtom)).toBe(maximized);
        expect(store.set(toggleActiveChatPanelMaximizedAtom)).toBe(true);
        expect(store.get(effectiveChatPanelMaximizedAtom)).toBe(!maximized);
      }
    }
  );

  it.each(FULL_WORKBENCH_TAB_TYPES)(
    "never shows a Station beside %s tabs and leaves the saved preference alone",
    (type) => {
      expect(isChatPanelTabStationAvailable(type)).toBe(false);
      for (const maximized of [false, true]) {
        const store = storeWithActiveTab(type, maximized);
        expect(store.get(effectiveChatPanelMaximizedAtom)).toBe(true);
        expect(store.set(toggleActiveChatPanelMaximizedAtom)).toBe(false);
        expect(store.get(chatPanelMaximizedAtom)).toBe(maximized);
      }
    }
  );

  it("forces the effective layout full-screen without changing the saved preference", () => {
    expect(resolveChatPanelMaximizedForLayout(false, "work-item")).toBe(true);
    expect(resolveChatPanelMaximizedForLayout(true, "work-item")).toBe(true);
    expect(resolveChatPanelMaximizedForLayout(false, "session")).toBe(false);
    expect(resolveChatPanelMaximizedForLayout(false, null)).toBe(false);
  });

  it.each<ChatPanelTabType>(["work-management", "runtime"])(
    "treats %s as a standalone tool surface",
    (type) => {
      expect(isStandaloneChatPanelToolTab(type)).toBe(true);
    }
  );

  it.each<ChatPanelTabType>(["session", "start-page", "terminal", "work-item"])(
    "does not treat %s as a standalone tool surface",
    (type) => {
      expect(isStandaloneChatPanelToolTab(type)).toBe(false);
    }
  );
});
