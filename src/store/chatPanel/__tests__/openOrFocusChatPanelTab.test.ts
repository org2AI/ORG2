import { beforeEach, describe, expect, it } from "vitest";

import {
  createInstrumentedStore,
  resetInstrumentedStore,
} from "@src/util/core/state/instrumentedStore";

import { createRuntimeTab, createSessionTab } from "../chatPanelTabFactories";
import { openOrFocusChatPanelTab } from "../chatPanelTabOpen/openOrFocus";
import {
  activeChatPanelTabAtom,
  chatPanelTabsAtom,
} from "../chatPanelTabsState";

describe("openOrFocusChatPanelTab", () => {
  beforeEach(() => {
    resetInstrumentedStore();
  });

  function open(store: ReturnType<typeof createInstrumentedStore>) {
    return openOrFocusChatPanelTab(store.get, store.set, {
      isMatch: (tab) => tab.type === "runtime",
      refresh: (tab) =>
        tab.title === "Runtime" ? tab : { ...tab, title: "Runtime" },
      create: () => createRuntimeTab({ title: "Runtime" }),
    });
  }

  it("mints and activates the tab when none matches", () => {
    const store = createInstrumentedStore();
    const tabId = open(store);
    expect(store.get(activeChatPanelTabAtom)).toMatchObject({
      id: tabId,
      type: "runtime",
      title: "Runtime",
    });
  });

  it("focuses and refreshes the matching tab instead of stacking another", () => {
    const store = createInstrumentedStore();
    const first = open(store);
    const session = createSessionTab({ sessionId: "s-1", title: "Chat" });
    store.set(chatPanelTabsAtom, (state) => ({
      tabs: [
        ...state.tabs.map((tab) =>
          tab.id === first ? { ...tab, title: "Stale" } : tab
        ),
        session,
      ],
      activeTabId: session.id,
    }));

    const second = open(store);

    expect(second).toBe(first);
    const state = store.get(chatPanelTabsAtom);
    expect(state.activeTabId).toBe(first);
    expect(state.tabs.filter((tab) => tab.type === "runtime")).toHaveLength(1);
    expect(state.tabs.find((tab) => tab.id === first)?.title).toBe("Runtime");
  });

  it("leaves the strip untouched when the refresh returns the same tab", () => {
    const store = createInstrumentedStore();
    open(store);
    const before = store.get(chatPanelTabsAtom);
    open(store);
    expect(store.get(chatPanelTabsAtom)).toBe(before);
  });
});
