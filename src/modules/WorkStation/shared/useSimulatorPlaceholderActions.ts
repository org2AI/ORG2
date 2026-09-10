/**
 * Quick actions for simulator / session-replay empty states.
 * Single source shared by SimulatorSingleView and per-app replay placeholders.
 */
import { useAtomValue, useSetAtom } from "jotai";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { getShortcutKeys } from "@src/config/keyboard/shortcutDisplay";
import {
  workStationEditorSecondaryCollapsedAtom,
  workStationEditorSecondaryCollapsedPersistAtom,
} from "@src/store/ui/workStationLayout/bottomPanelAtoms";
import {
  workStationPrimarySidebarCollapsedAtom,
  workStationPrimarySidebarCollapsedPersistAtom,
} from "@src/store/ui/workStationLayout/primarySidebarAtoms";

import type { QuickAction } from "./QuickActionsPanel/types";

/** Host context for session-replay empty states (Activity Simulator vs standalone). */
export type SessionReplayPlaceholderMode = "interactive" | "simulation";

/** Caption for simulator replay panes waiting on Agent tool output */
export function useSimulatorAwaitingAgentCaption(): string {
  return "";
}

/**
 * Layout shortcut hints for session-replay empty states.
 * In {@link SessionReplayPlaceholderMode} `"simulation"` (Activity Simulator), returns no actions — panel toggles are not shown.
 */
export function useSimulatorPlaceholderActions(
  sessionReplayMode: SessionReplayPlaceholderMode = "simulation"
): QuickAction[] {
  const { t } = useTranslation();

  const bottomPanelCollapsed = useAtomValue(
    workStationEditorSecondaryCollapsedAtom
  );
  const sidebarCollapsed = useAtomValue(workStationPrimarySidebarCollapsedAtom);

  const setBottomPanel = useSetAtom(
    workStationEditorSecondaryCollapsedPersistAtom
  );
  const setPrimarySidebar = useSetAtom(
    workStationPrimarySidebarCollapsedPersistAtom
  );

  return useMemo(() => {
    if (sessionReplayMode === "simulation") {
      return [];
    }
    return [
      {
        id: "toggle-bottom-panel",
        label: bottomPanelCollapsed
          ? t("commands.showBottomPanel")
          : t("commands.hideBottomPanel"),
        get shortcut() {
          return getShortcutKeys("toggle_bottom_panel");
        },
        onAction: () => setBottomPanel("toggle"),
      },
      {
        id: "toggle-primary-sidebar",
        label: sidebarCollapsed
          ? t("commands.showPrimarySidebar")
          : t("commands.hidePrimarySidebar"),
        get shortcut() {
          return getShortcutKeys("toggle_workstation_sidebar");
        },
        onAction: () => setPrimarySidebar("toggle"),
      },
    ];
  }, [
    sessionReplayMode,
    t,
    bottomPanelCollapsed,
    sidebarCollapsed,
    setBottomPanel,
    setPrimarySidebar,
  ]);
}
