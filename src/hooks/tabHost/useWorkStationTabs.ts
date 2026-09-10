/**
 * Workstation tab hook — single backing store across every host.
 *
 * Every tab — whether code/file, browser session, project work item,
 * launchpad dashboard, etc. — lives in the lone
 * `workstationLayoutAtom.mainPane` and is mutated through this hook.
 */
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo } from "react";

import {
  type PanelState,
  type WorkStationLayoutState,
  type WorkStationTab,
  claimLegacyWorkstationSeedAtom,
  closeWorkstationTabAtom,
  mainPaneActiveTabIdAtom,
  mainPaneTabsAtom,
  openTab as openTabMutation,
  presentedWorkstationWorkspaceKeyAtom,
  updateTabData as updateTabDataMutation,
  workstationLayoutAtom,
} from "@src/store/workstation/tabs";

// ============================================
// Types
// ============================================

export interface UseWorkStationTabsReturn {
  tabs: WorkStationTab[];
  activeTabId: string | null;
  activeTab: WorkStationTab | null;

  openTab: (tab: WorkStationTab) => void;
  /** Programmatic removal: release resources without offering deleted data in recents. */
  removeTab: (tabId: string) => void;

  updateTabData: (
    tabId: string,
    data: Partial<Record<string, unknown>>
  ) => void;
  updateTabMeta: (
    tabId: string,
    meta: Partial<Pick<WorkStationTab, "title" | "icon">>
  ) => void;
  setTabUnsaved: (tabId: string, hasUnsavedChanges: boolean) => void;
}

const EMPTY_PANE_STATE: PanelState = { tabs: [], activeTabId: null };

// ============================================
// Main Hook
// ============================================

export function useWorkStationTabs(): UseWorkStationTabsReturn {
  const tabs = useAtomValue(mainPaneTabsAtom);
  const activeTabId = useAtomValue(mainPaneActiveTabIdAtom);
  const workspaceKey = useAtomValue(presentedWorkstationWorkspaceKeyAtom);
  const setLayout = useSetAtom(workstationLayoutAtom);
  const removeWorkstationTab = useSetAtom(closeWorkstationTabAtom);
  const claimLegacySeed = useSetAtom(claimLegacyWorkstationSeedAtom);

  // A legacy v2 task workspace is claimed only after a user has explicitly
  // entered a WorkStation session. Cold-start Global Workspace never claims it.
  useEffect(() => {
    claimLegacySeed();
  }, [claimLegacySeed, workspaceKey]);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? null,
    [tabs, activeTabId]
  );

  const updatePane = useCallback(
    (updater: (state: PanelState) => PanelState) => {
      setLayout((prev: WorkStationLayoutState) => {
        const currentPane = prev?.mainPane ?? EMPTY_PANE_STATE;
        const nextPane = updater(currentPane);
        if (nextPane === currentPane) return prev;
        return {
          ...prev,
          mainPane: nextPane,
        };
      });
    },
    [setLayout]
  );

  const openTab = useCallback(
    (tab: WorkStationTab) => updatePane((state) => openTabMutation(state, tab)),
    [updatePane]
  );

  const removeTab = useCallback(
    (tabId: string) => removeWorkstationTab({ workspace: workspaceKey, tabId }),
    [removeWorkstationTab, workspaceKey]
  );

  const updateTabData = useCallback(
    (tabId: string, data: Partial<Record<string, unknown>>) => {
      updatePane((state) => updateTabDataMutation(state, tabId, data));
    },
    [updatePane]
  );

  const updateTabMeta = useCallback(
    (tabId: string, meta: Partial<Pick<WorkStationTab, "title" | "icon">>) => {
      updatePane((state) => {
        const target = state.tabs.find((tab) => tab.id === tabId);
        if (!target) return state;
        const nextTitle = meta.title ?? target.title;
        const nextIcon = meta.icon ?? target.icon;
        if (target.title === nextTitle && target.icon === nextIcon) {
          return state;
        }
        return {
          ...state,
          tabs: state.tabs.map((tab: WorkStationTab) =>
            tab.id === tabId
              ? { ...tab, title: nextTitle, icon: nextIcon }
              : tab
          ),
        };
      });
    },
    [updatePane]
  );

  const setTabUnsaved = useCallback(
    (tabId: string, hasUnsavedChanges: boolean) => {
      updatePane((state) => {
        const target = state.tabs.find((tab) => tab.id === tabId);
        if (!target || target.hasUnsavedChanges === hasUnsavedChanges) {
          return state;
        }
        return {
          ...state,
          tabs: state.tabs.map((tab: WorkStationTab) =>
            tab.id === tabId ? { ...tab, hasUnsavedChanges } : tab
          ),
        };
      });
    },
    [updatePane]
  );

  return {
    tabs,
    activeTabId,
    activeTab,
    openTab,
    removeTab,
    updateTabData,
    updateTabMeta,
    setTabUnsaved,
  };
}
