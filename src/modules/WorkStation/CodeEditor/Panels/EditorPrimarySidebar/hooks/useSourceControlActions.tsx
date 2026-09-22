/**
 * useSourceControlActions
 *
 * Builds the action button list for the Source Control sidebar tab header.
 * Extracted from `useExplorerActions` so the Source Control sidebar module
 * can be reused outside the Code Editor (e.g. Control Tower peek).
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import AnyIcon from "@src/components/AnyIcon";
import type { SectionHeaderAction } from "@src/components/TreePanelSidebar/types";

import { ICON_CONFIG, PANEL_CONSTANTS } from "../config";

const {
  search: SearchIcon,
  listTree: ListTreeIcon,
  list: ListIcon,
} = ICON_CONFIG;

export interface UseSourceControlActionsOptions {
  showFilter: boolean;
  viewMode: "list-tree" | "list";
  onToggleFilter: () => void;
  onToggleViewMode: () => void;
}

export function useSourceControlActions({
  showFilter,
  viewMode,
  onToggleFilter,
  onToggleViewMode,
}: UseSourceControlActionsOptions): SectionHeaderAction[] {
  const { t } = useTranslation("common");

  return useMemo<SectionHeaderAction[]>(() => {
    const actions: SectionHeaderAction[] = [
      {
        key: "filter-git",
        icon: (
          <AnyIcon
            icon={SearchIcon}
            size={PANEL_CONSTANTS.ACTION_ICON_SIZE}
            strokeWidth={PANEL_CONSTANTS.ACTION_ICON_STROKE}
            className={showFilter ? "text-primary-6" : ""}
          />
        ),
        tooltip: t("actions.search"),
        onClick: onToggleFilter,
      },
      {
        key: "view-mode-toggle",
        icon:
          viewMode === "list" ? (
            <AnyIcon
              icon={ListTreeIcon}
              size={PANEL_CONSTANTS.ACTION_ICON_SIZE}
              strokeWidth={PANEL_CONSTANTS.ACTION_ICON_STROKE}
            />
          ) : (
            <AnyIcon
              icon={ListIcon}
              size={PANEL_CONSTANTS.ACTION_ICON_SIZE}
              strokeWidth={PANEL_CONSTANTS.ACTION_ICON_STROKE}
            />
          ),
        tooltip:
          viewMode === "list-tree"
            ? "Switch to list view"
            : "Switch to tree view",
        onClick: onToggleViewMode,
      },
    ];

    return actions;
  }, [showFilter, viewMode, onToggleFilter, onToggleViewMode, t]);
}
