/**
 * useEditorPaneFileState
 *
 * The editor pane's tab state plus the live file-content manager for the
 * active file tab. The two are bridged by refs so `closeTab` can save the
 * active file on close.
 */
import { useEffect, useMemo, useRef } from "react";

import {
  type UseFileContentManagerReturn,
  useEditorPaneState,
  useFileContentManager,
} from "./hooks";

interface UseEditorPaneFileStateOptions {
  /** Git status refresh, run after a successful save and after save-on-close. */
  forceRefresh: () => void;
}

export function useEditorPaneFileState({
  forceRefresh,
}: UseEditorPaneFileStateOptions) {
  // Refs for the pane state hook (needed for save-on-close). Declared ahead
  // of it so the hook is called exactly once: they are only dereferenced
  // inside closeTab's async body, never during render, so the effect below
  // populates them well before any user interaction can reach them.
  const fileContentStateRef = useRef<UseFileContentManagerReturn | null>(null);
  const forceRefreshRef = useRef(forceRefresh);

  const { tabs, activeTabId, activeTab, closeTab, updatePaneState } =
    useEditorPaneState(fileContentStateRef, forceRefreshRef);

  // ============================================
  // File Content Manager (extracted hook)
  // ============================================

  const activeFilePath = useMemo(() => {
    if (activeTab?.type === "file") {
      return activeTab.data.filePath as string;
    }
    return null;
  }, [activeTab]);

  const activeFileIsCsvTable = useMemo(() => {
    if (!activeFilePath) return false;
    const lowerPath = activeFilePath.toLowerCase();
    return lowerPath.endsWith(".csv") || lowerPath.endsWith(".tsv");
  }, [activeFilePath]);

  // File content manager with handlers
  const fileContentManager = useFileContentManager({
    activeFilePath,
    onSaveSuccess: forceRefresh,
  });

  // Update refs in effect (not during render)
  useEffect(() => {
    fileContentStateRef.current = fileContentManager;
    forceRefreshRef.current = forceRefresh;
  });

  return {
    tabs,
    activeTabId,
    activeTab,
    closeTab,
    updatePaneState,
    activeFilePath,
    activeFileIsCsvTable,
    fileContentManager,
  };
}
