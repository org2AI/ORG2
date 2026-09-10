/**
 * PanelService - Singleton Panel Management Service
 *
 * Provides panel visibility and tab management shared by both AI and UI.
 * Uses persist atoms for localStorage sync.
 *
 * Usage:
 *   import { PanelService } from "@src/services/panel";
 *   PanelService.showPrimarySidebar("testing");
 */
import { workStationEditorSecondaryCollapsedPersistAtom } from "@src/store/ui/workStationLayout/bottomPanelAtoms";
import {
  type PrimarySidebarTabKey,
  workStationPrimarySidebarCollapsedAtom,
  workStationPrimarySidebarCollapsedPersistAtom,
  workStationPrimarySidebarTabAtom,
} from "@src/store/ui/workStationLayout/primarySidebarAtoms";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";

const getStore = () => getInstrumentedStore();

export const PanelService = {
  // ==========================================
  // Primary sidebar
  // ==========================================

  /**
   * Show a specific primary sidebar tab. Expands the sidebar if collapsed.
   */
  showPrimarySidebar(tab: PrimarySidebarTabKey): void {
    const store = getStore();
    store.set(workStationPrimarySidebarTabAtom, tab);
    if (store.get(workStationPrimarySidebarCollapsedAtom)) {
      store.set(workStationPrimarySidebarCollapsedPersistAtom, false);
    }
  },

  /**
   * Toggle primary sidebar visibility (persisted).
   */
  togglePrimarySidebar(): void {
    getStore().set(workStationPrimarySidebarCollapsedPersistAtom, "toggle");
  },

  // ==========================================
  // Bottom Panel
  // ==========================================

  /**
   * Toggle bottom panel visibility (persisted).
   */
  toggleBottomPanel(): void {
    getStore().set(workStationEditorSecondaryCollapsedPersistAtom, "toggle");
  },
};
