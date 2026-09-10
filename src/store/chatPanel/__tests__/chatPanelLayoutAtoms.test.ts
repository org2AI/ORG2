import { createStore } from "jotai";
import { describe, expect, it } from "vitest";

import { chatPanelMaximizedAtom } from "@src/store/ui/chatPanel/surfaceAtoms";

import { effectiveChatPanelMaximizedAtom } from "../chatPanelLayoutAtoms";
import { chatPanelTabsAtom } from "../chatPanelTabsState";

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
