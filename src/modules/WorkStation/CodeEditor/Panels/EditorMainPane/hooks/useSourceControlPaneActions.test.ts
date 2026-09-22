// @vitest-environment jsdom
import type { TFunction } from "i18next";
import { Provider, createStore } from "jotai";
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { useSourceControlActions } from "@src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/hooks/useSourceControlActions";
import SourceControlTabSidebarContent from "@src/modules/WorkStation/shared/SidebarModules/SourceControl/SourceControlTabSidebarContent";
import type { TabSidebarProps } from "@src/modules/WorkStation/shared/SidebarModules/registry";
import { sourceControlRefreshHandlerAtom } from "@src/store/workstation/codeEditor/sourceControlRefreshAtom";
import {
  type PanelState,
  createSourceControlTab,
} from "@src/store/workstation/tabs";

import { useSourceControlPaneActions } from "./useSourceControlPaneActions";

const mocks = vi.hoisted(() => ({
  pane: { current: null as { refresh: () => Promise<void> } | null },
}));
vi.mock(
  "@src/modules/WorkStation/shared/SidebarModules/SourceControl/useSourceControlSidebarModule",
  () => ({
    useSourceControlSidebarModule: () => ({
      tab: { key: "source-control" },
      ref: mocks.pane,
    }),
  })
);
vi.mock("@src/modules/WorkStation/shared/PrimarySidebarLayout", () => ({
  PrimarySidebarLayoutWithSections: () => null,
}));
vi.mock("@src/hooks/git/useRepoSelection", () => ({
  useRepoSelection: () => ({ currentBranch: "develop" }),
}));
vi.mock("@src/components/RefreshIcon/useRefreshSpin", () => ({
  useRefreshSpin: (refresh: () => void) => ({ handleClick: refresh }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../config", () => ({ createSourceControlQuickActions: () => [] }));

it.each(["file", "commit", "stash"] as const)(
  "closes the selected %s without closing Source Control and is idempotent",
  (kind) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const root = createRoot(document.createElement("div"));
    const tab = createSourceControlTab(1);
    if (kind === "file") {
      tab.data.focusPath = "src/index.ts";
    } else {
      tab.data.historySelection = {
        type: kind,
        commitSha: "abc1234",
        shortSha: "abc1234",
        commitMessage: "Saved changes",
        ...(kind === "stash"
          ? {
              stashIndex: 0,
              stashRef: "stash@{0}",
              stashIdentity: "abc1234",
              stashCommitSha: "abc1234",
            }
          : {}),
      };
    }
    let state: PanelState = { tabs: [tab], activeTabId: tab.id };
    let close!: () => void;
    const Harness = () => {
      const closeSelection = useSourceControlPaneActions({
        t: ((key: string) => key) as TFunction,
        updatePaneState: (update) => {
          state = update(state);
        },
        forceRefresh: vi.fn(async () => {}),
        gitDiffLoading: false,
        sourceControlFilterMode: "uncommitted",
      }).handleSourceControlCloseFocus;
      useEffect(() => {
        close = closeSelection;
      }, [closeSelection]);
      return null;
    };
    try {
      act(() =>
        root.render(
          createElement(
            Provider,
            { store: createStore() },
            createElement(Harness)
          )
        )
      );
      act(() => close());
      expect(state.tabs).toHaveLength(1);
      expect(state.activeTabId).toBe(tab.id);
      expect(state.tabs[0].data.focusPath).toBeNull();
      expect(state.tabs[0].data.historySelection).toBeNull();
      const closed = state;
      act(() => close());
      expect(state).toBe(closed);
    } finally {
      act(() => root.unmount());
      vi.unstubAllGlobals();
    }
  }
);

it("routes the header to the mounted scope, avoids duplicate refresh, and falls back after unmount", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  const store = createStore();
  const fallback = vi.fn(async () => {});
  const mainRepo = vi.fn(async () => {});
  const worktree = vi.fn(async () => {});
  mocks.pane.current = { refresh: mainRepo };
  let refresh!: () => void;
  let actionKeys: string[] = [];
  const Harness = () => {
    const paneActions = useSourceControlPaneActions({
      t: ((key: string) => key) as TFunction,
      updatePaneState: vi.fn(),
      forceRefresh: fallback,
      gitDiffLoading: false,
      sourceControlFilterMode: "uncommitted",
    }).handleSourceControlRefresh;
    const actions = useSourceControlActions({
      showFilter: false,
      viewMode: "list-tree",
      onToggleFilter: vi.fn(),
      onToggleViewMode: vi.fn(),
    }).map((action) => action.key);
    useEffect(() => {
      refresh = paneActions;
      actionKeys = actions;
    }, [paneActions, actions]);
    return null;
  };
  const render = (sidebar: boolean) =>
    act(() =>
      root.render(
        createElement(
          Provider,
          { store },
          sidebar
            ? createElement(SourceControlTabSidebarContent, {
                context: { repoId: "repo", repoPath: "/repo" },
              } as TabSidebarProps)
            : null,
          createElement(Harness)
        )
      )
    );
  try {
    render(true);
    expect(actionKeys).toEqual(["filter-git", "view-mode-toggle"]);
    act(() => refresh());
    expect(mainRepo).toHaveBeenCalledOnce();
    expect(fallback).not.toHaveBeenCalled();
    mocks.pane.current = { refresh: worktree };
    act(() => refresh());
    expect(worktree).toHaveBeenCalledOnce();
    expect(mainRepo).toHaveBeenCalledOnce();
    const failure = new Error("Refresh failed");
    const logError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mocks.pane.current = { refresh: vi.fn(() => Promise.reject(failure)) };
      await act(async () => refresh());
      expect(logError).toHaveBeenCalledWith(
        "[SourceControl] Failed to refresh Git status",
        failure
      );
      expect(fallback).not.toHaveBeenCalled();
    } finally {
      logError.mockRestore();
    }
    mocks.pane.current = null;
    act(() => refresh());
    expect(fallback).toHaveBeenCalledOnce();
    render(false);
    expect(store.get(sourceControlRefreshHandlerAtom)).toBeNull();
    act(() => refresh());
    expect(fallback).toHaveBeenCalledTimes(2);
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
