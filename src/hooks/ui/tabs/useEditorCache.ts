/**
 * useEditorCache Hook (v3)
 *
 * Manages FILE-tab caches for the currently presented WorkStation workspace.
 * Repository identity is nested beneath workspace identity, so two sessions on
 * the same repository retain independent file tabs and active repo selection.
 * Shared resource tabs stay in the compatibility layout during repo switches.
 *
 * Created: 2026-01-29
 */
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback } from "react";

import {
  FILE_TAB_TYPES,
  type WorkStationTab,
  activeEditorRepoAtom,
  editorCacheAtom,
  mainPaneStateAtom,
  saveRepoCacheAtom,
  switchActiveRepoAtom,
  workstationLayoutAtom,
} from "@src/store/workstation/tabs";

// ============================================
// Helpers
// ============================================

/**
 * Check if a tab is a file tab (cached per-repo)
 */
function isFileTab(tab: WorkStationTab): boolean {
  return FILE_TAB_TYPES.includes(tab.type as (typeof FILE_TAB_TYPES)[number]);
}

/**
 * Check if a tab is a tool tab (global, not cached)
 */
function isToolTab(tab: WorkStationTab): boolean {
  return !isFileTab(tab);
}

// ============================================
// Types
// ============================================

export interface UseEditorCacheReturn {
  /** Save the current repo's file tabs and swap in the cached ones for `newRepoPath`. */
  switchRepo: (newRepoPath: string) => void;
}

// ============================================
// Hook Implementation
// ============================================

export function useEditorCache(): UseEditorCacheReturn {
  const cache = useAtomValue(editorCacheAtom);
  const activeRepoPath = useAtomValue(activeEditorRepoAtom);

  const [editorLayout, setEditorLayout] = useAtom(workstationLayoutAtom);
  const mainPaneState = useAtomValue(mainPaneStateAtom);

  const saveToCache = useSetAtom(saveRepoCacheAtom);
  const switchActiveRepo = useSetAtom(switchActiveRepoAtom);

  /**
   * Switch to a different repo
   *
   * What happens:
   * 1. Save current FILE tabs to cache
   * 2. Keep TOOL tabs (terminal, browser) in place
   * 3. Restore cached FILE tabs for new repo (if any)
   * 4. Merge: tool tabs + new file tabs
   */
  const switchRepo = useCallback(
    (newRepoPath: string): void => {
      // Don't do anything if same repo
      if (newRepoPath === activeRepoPath) return;

      const currentTabs = mainPaneState?.tabs ?? [];
      const currentActiveId = mainPaneState?.activeTabId ?? null;

      // Save current file tabs before switching
      if (activeRepoPath) {
        const fileTabs = currentTabs.filter(isFileTab);
        const fallbackFileTabId = fileTabs[0]?.id ?? null;
        const activeFileTabId = fileTabs.some(
          (tab) => tab.id === currentActiveId
        )
          ? currentActiveId
          : fallbackFileTabId;

        saveToCache({
          repoPath: activeRepoPath,
          fileTabs,
          activeFileTabId,
          lastAccessedAt: Date.now(),
        });
      }

      // Update active repo
      switchActiveRepo(newRepoPath);

      // Get tool tabs (these stay in place)
      const toolTabs = currentTabs.filter(isToolTab);

      // Get cached file tabs for new repo (or empty)
      const cached = cache[newRepoPath];
      const newFileTabs = cached?.fileTabs ?? [];
      const newActiveFileTabId = cached?.activeFileTabId ?? null;

      // Merge: tool tabs + new file tabs
      const newTabs = [...toolTabs, ...newFileTabs];

      // Determine new active tab
      // If current active was a tool tab, keep it
      // Otherwise, use the cached active file tab or first file tab
      const wasActiveToolTab = toolTabs.some(
        (tab) => tab.id === currentActiveId
      );
      const firstNewFileTabId = newFileTabs[0]?.id ?? null;
      const firstToolTabId = toolTabs[0]?.id ?? null;
      const newActiveId = wasActiveToolTab
        ? currentActiveId
        : (newActiveFileTabId ?? firstNewFileTabId ?? firstToolTabId);

      if (editorLayout) {
        setEditorLayout({
          ...editorLayout,
          mainPane: {
            tabs: newTabs,
            activeTabId: newActiveId,
          },
        });
      }
    },
    [
      activeRepoPath,
      mainPaneState,
      saveToCache,
      switchActiveRepo,
      cache,
      editorLayout,
      setEditorLayout,
    ]
  );

  return { switchRepo };
}
