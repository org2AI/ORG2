// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ROUTES } from "@src/config/routes";
import { createSessionTab } from "@src/store/chatPanel/chatPanelTabFactories";
import { chatPanelTabsAtom } from "@src/store/chatPanel/chatPanelTabsState";
import { chatPanelMaximizedAtom } from "@src/store/ui/chatPanel/surfaceAtoms";
import { stationModeAtom } from "@src/store/ui/simulatorAtom";
import {
  createInstrumentedStore,
  resetInstrumentedStore,
} from "@src/util/core/state/instrumentedStore";

import { EditorTabService } from "./EditorTabService";
import { openPullRequestTab } from "./openPullRequestTab";

describe("PR navigation beside chat", () => {
  beforeEach(() => {
    localStorage.clear();
    resetInstrumentedStore();
    window.history.replaceState({}, "", ROUTES.workStation.code.path);
  });
  afterEach(() => resetInstrumentedStore());

  it("preserves the active conversation while opening and refocusing workstation PR tabs", () => {
    const store = createInstrumentedStore();
    const chat = createSessionTab({ sessionId: "session-a" });
    const chatState = { tabs: [chat], activeTabId: chat.id };
    store.set(chatPanelTabsAtom, chatState);
    store.set(stationModeAtom, "agent-station");
    store.set(chatPanelMaximizedAtom, true);
    const pr = {
      prNumber: 2153,
      prTitle: "Rail",
      prUrl: "https://github.com/org2ai/org2/pull/2153",
      prStatus: "open",
      headBranch: "feature",
      repoPath: "",
    };
    openPullRequestTab(pr);
    expect(store.get(chatPanelTabsAtom)).toBe(chatState);
    expect(store.get(stationModeAtom)).toBe("my-station");
    expect(store.get(chatPanelMaximizedAtom)).toBe(false);
    const first = EditorTabService.getActiveTab();
    expect(first).toMatchObject({
      type: "github-pr-detail",
      data: { prNumber: 2153 },
    });
    openPullRequestTab({
      ...pr,
      prNumber: 2152,
      prUrl: "https://github.com/org2ai/org2/pull/2152",
    });
    expect(EditorTabService.getActiveTabId()).not.toBe(first!.id);
    openPullRequestTab(pr);
    expect(EditorTabService.getActiveTabId()).toBe(first!.id);
    expect(
      EditorTabService.getTabs().filter(
        (tab) => tab.type === "github-pr-detail"
      )
    ).toHaveLength(2);
    expect(store.get(chatPanelTabsAtom)).toBe(chatState);
  });
});
