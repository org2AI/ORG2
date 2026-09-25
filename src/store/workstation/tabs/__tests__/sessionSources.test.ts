import { beforeEach, describe, expect, it } from "vitest";

import { createSessionSourcesTab } from "../factories/sessionSources";
import {
  emptyWorkstationTabsState,
  loadWorkstationTabsState,
  persistWorkstationTabsState,
} from "../storage";
import { closeTab, openTab } from "../tabMutations";
import { getWorkstationTabOwnership } from "../types";
import type { PanelState, WorkstationWorkspaceState } from "../types";

beforeEach(() => localStorage.clear());

describe("session sources tab lifecycle", () => {
  it("reuses a session's tab while keeping another session independently selectable", () => {
    const first = createSessionSourcesTab("session-a", "Sources");
    const second = createSessionSourcesTab("session-b", "Sources");
    let pane: PanelState = { tabs: [], activeTabId: null };
    pane = openTab(pane, first);
    pane = openTab(pane, second);
    pane = openTab(pane, createSessionSourcesTab("session-a", "来源"));

    expect(pane.tabs).toHaveLength(2);
    expect(pane.activeTabId).toBe(first.id);
    expect(pane.tabs.map((tab) => tab.data.sessionId)).toEqual([
      "session-a",
      "session-b",
    ]);
    expect(first.id).not.toBe(second.id);

    pane = closeTab(pane, first.id);
    expect(pane.tabs.map((tab) => tab.id)).toEqual([second.id]);
    pane = openTab(pane, first);
    expect(pane.tabs).toHaveLength(2);
    expect(pane.activeTabId).toBe(first.id);
  });

  it("restores session binding and active selection in the owning workspace", () => {
    const first = createSessionSourcesTab("session-a", "Sources");
    const second = createSessionSourcesTab("session-b", "Sources");
    const workspace = (
      tab: ReturnType<typeof createSessionSourcesTab>
    ): WorkstationWorkspaceState => ({
      tabs: [tab],
      activeTabRef: { partition: "workspace", tabId: tab.id },
      tabOrder: [{ partition: "workspace", tabId: tab.id }],
    });
    const state = emptyWorkstationTabsState();
    state.sessionWorkspaces["session-a"] = workspace(first);
    state.sessionWorkspaces["session-b"] = workspace(second);

    expect(getWorkstationTabOwnership(first.type)).toBe("workspace-local");
    expect(persistWorkstationTabsState(state)).toBe(true);
    const restored = loadWorkstationTabsState();
    expect(restored.sessionWorkspaces["session-a"]).toMatchObject(
      workspace(first)
    );
    expect(restored.sessionWorkspaces["session-b"]).toMatchObject(
      workspace(second)
    );
    expect(restored.shared.tabs).toEqual([]);
  });
});
