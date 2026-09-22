/**
 * useWorkStationPanels Hook
 *
 * React bindings for panel state management.
 * Core actions delegate to PanelService (singleton).
 *
 * Shared by: AppShell, CodeEditor, Browser
 *
 * - Uses useAtomValue for read-only subscriptions (no setter = no extra closure)
 * - Uses useSetAtom for write-only operations (no re-render on value change)
 * - This prevents unnecessary re-renders when unrelated panel state changes
 */
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback } from "react";

import {
  workStationDevToolsCollapsedAtom,
  workStationDevToolsCollapsedPersistAtom,
} from "@src/store/ui/workStationLayout/devToolsCollapsedAtoms";
import {
  workStationPrimarySidebarCollapsedAtom,
  workStationPrimarySidebarCollapsedPersistAtom,
  workStationPrimarySidebarWidthAtom,
  workStationPrimarySidebarWidthPersistAtom,
} from "@src/store/ui/workStationLayout/primarySidebarAtoms";
import {
  type LayoutMode,
  workStationLayoutModeAtom,
  workStationLayoutModePersistAtom,
} from "@src/store/ui/workStationLayout/splitLayoutAtoms";

export interface UseWorkStationPanelsReturn {
  // Layout mode
  layoutMode: LayoutMode;
  setLayoutMode: (mode: LayoutMode) => void;

  // Primary sidebar (one rail, visually left or right via CSS swap)
  primarySidebarCollapsed: boolean;
  setPrimarySidebarCollapsed: (collapsed: boolean) => void;
  togglePrimarySidebar: () => void;
  closePrimarySidebar: () => void;
  primarySidebarWidth: number;
  setPrimarySidebarWidth: (width: number) => void;

  // Browser DevTools panel
  devToolsCollapsed: boolean;
  setDevToolsCollapsed: (collapsed: boolean) => void;
  toggleDevTools: () => void;
}

export function useWorkStationPanels(): UseWorkStationPanelsReturn {
  // PERFORMANCE: Use useAtomValue for read-only (subscribes to base atom only)
  // Use useSetAtom for write-only (no subscription, no re-render on change)

  const layoutMode = useAtomValue(workStationLayoutModeAtom);
  const setLayoutModePersist = useSetAtom(workStationLayoutModePersistAtom);

  // Primary sidebar — one atom regardless of left/right layout mode.
  const primarySidebarCollapsed = useAtomValue(
    workStationPrimarySidebarCollapsedAtom
  );
  const setPrimarySidebarCollapsedPersist = useSetAtom(
    workStationPrimarySidebarCollapsedPersistAtom
  );
  const primarySidebarWidth = useAtomValue(workStationPrimarySidebarWidthAtom);
  const setPrimarySidebarWidthPersist = useSetAtom(
    workStationPrimarySidebarWidthPersistAtom
  );

  const devToolsCollapsed = useAtomValue(workStationDevToolsCollapsedAtom);
  const setDevToolsCollapsedPersist = useSetAtom(
    workStationDevToolsCollapsedPersistAtom
  );

  const togglePrimarySidebar = useCallback(() => {
    setPrimarySidebarCollapsedPersist(!primarySidebarCollapsed);
  }, [primarySidebarCollapsed, setPrimarySidebarCollapsedPersist]);

  const closePrimarySidebar = useCallback(() => {
    setPrimarySidebarCollapsedPersist(true);
  }, [setPrimarySidebarCollapsedPersist]);

  const toggleDevTools = useCallback(() => {
    setDevToolsCollapsedPersist(!devToolsCollapsed);
  }, [devToolsCollapsed, setDevToolsCollapsedPersist]);

  return {
    layoutMode,
    setLayoutMode: setLayoutModePersist,

    primarySidebarCollapsed,
    setPrimarySidebarCollapsed: setPrimarySidebarCollapsedPersist,
    togglePrimarySidebar,
    closePrimarySidebar,
    primarySidebarWidth,
    setPrimarySidebarWidth: setPrimarySidebarWidthPersist,

    devToolsCollapsed,
    setDevToolsCollapsed: setDevToolsCollapsedPersist,
    toggleDevTools,
  };
}

// ============================================
// Focused Hooks for Better Performance
// ============================================

/**
 * Hook for primary sidebar state. Use this instead of
 * `useWorkStationPanels` when you only need the primary sidebar.
 */
export function usePrimarySidebarState() {
  const layoutMode = useAtomValue(workStationLayoutModeAtom);
  const setLayoutMode = useSetAtom(workStationLayoutModePersistAtom);
  const primarySidebarCollapsed = useAtomValue(
    workStationPrimarySidebarCollapsedAtom
  );
  const primarySidebarWidth = useAtomValue(workStationPrimarySidebarWidthAtom);
  const setPrimarySidebarWidth = useSetAtom(
    workStationPrimarySidebarWidthPersistAtom
  );
  const setPrimarySidebarCollapsed = useSetAtom(
    workStationPrimarySidebarCollapsedPersistAtom
  );

  const togglePrimarySidebar = useCallback(() => {
    setPrimarySidebarCollapsed("toggle");
  }, [setPrimarySidebarCollapsed]);

  const closePrimarySidebar = useCallback(() => {
    setPrimarySidebarCollapsed(true);
  }, [setPrimarySidebarCollapsed]);

  return {
    layoutMode,
    setLayoutMode,
    primarySidebarCollapsed,
    primarySidebarWidth,
    setPrimarySidebarWidth,
    setPrimarySidebarCollapsed,
    togglePrimarySidebar,
    closePrimarySidebar,
  };
}
