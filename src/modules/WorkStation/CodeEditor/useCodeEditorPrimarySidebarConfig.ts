import { type ReactNode, useMemo } from "react";

import type { UseWorkStationPanelsReturn } from "@src/hooks/tabHost/useWorkStationPanels";
import type { WorkStationTab } from "@src/store/workstation/tabs";

import { buildPrimarySidebarConfig } from "../shared";
import { CODE_EDITOR_CONFIG } from "./config";

interface UseCodeEditorPrimarySidebarConfigOptions {
  sidebarContent: ReactNode;
  activeTab: WorkStationTab | null;
  panels: UseWorkStationPanelsReturn;
}

/**
 * Primary sidebar shell config. The sidebar is hidden while it is collapsed
 * or while the active tab type brings no sidebar of its own.
 */
export function useCodeEditorPrimarySidebarConfig({
  sidebarContent,
  activeTab,
  panels,
}: UseCodeEditorPrimarySidebarConfigOptions) {
  const activeTabHasNoSidebar =
    activeTab?.type === "agent-config" ||
    activeTab?.type === "chat-session" ||
    activeTab?.type === "github-issue-detail" ||
    activeTab?.type === "github-pr-detail" ||
    activeTab?.type === "search-sessions" ||
    activeTab?.type === "search";
  const sidebarVisible =
    !activeTabHasNoSidebar && !panels.primarySidebarCollapsed;

  return useMemo(
    () =>
      buildPrimarySidebarConfig({
        content: sidebarContent,
        collapsed: !sidebarVisible,
        size: sidebarVisible ? panels.primarySidebarWidth : 0,
        onSizeChange: panels.setPrimarySidebarWidth,
        onClose: panels.closePrimarySidebar,
        onPositionChange: panels.setLayoutMode,
        minSize: 240,
        maxSize: 500,
        resetSize: CODE_EDITOR_CONFIG.defaultTreeWidth,
      }),
    [
      sidebarContent,
      sidebarVisible,
      panels.primarySidebarWidth,
      panels.setPrimarySidebarWidth,
      panels.closePrimarySidebar,
      panels.setLayoutMode,
    ]
  );
}
