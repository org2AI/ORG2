import React from "react";
import { useTranslation } from "react-i18next";

import { DropdownItem, DropdownPanel } from "@src/components/Dropdown/exports";
import type { SubmenuAnchor } from "@src/components/Dropdown/submenuLayout";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_WIDTHS,
} from "@src/components/Dropdown/tokens";

import type { SessionFilterSubmenu } from "./sessionFilterTypes";
import {
  SESSION_SORT_MODES,
  type SessionSortMode,
} from "./sidebarSessionOrder";
import {
  SESSION_GROUP_VISIBLE_COUNTS,
  type SessionGroupVisibleCount,
} from "./types";

interface SessionFilterSubmenuPanelProps {
  submenuPanelRef: React.RefObject<HTMLDivElement | null>;
  activeSubmenu: SessionFilterSubmenu;
  submenuAnchor: SubmenuAnchor;
  groupByModes: readonly string[];
  groupByMode: string;
  sortMode: SessionSortMode;
  setSortMode: (mode: SessionSortMode) => void;
  groupVisibleCount: SessionGroupVisibleCount;
  resolveGroupByLabel: (mode: string) => string;
  handleSelect: (mode: string) => void;
  handleGroupVisibleCountSelect: (count: SessionGroupVisibleCount) => void;
  handleSubmenuPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  handleSubmenuMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void;
}

/** The open second level: grouping modes, sort modes, or recent-session counts. */
export function SessionFilterSubmenuPanel({
  submenuPanelRef,
  activeSubmenu,
  submenuAnchor,
  groupByModes,
  groupByMode,
  sortMode,
  setSortMode,
  groupVisibleCount,
  resolveGroupByLabel,
  handleSelect,
  handleGroupVisibleCountSelect,
  handleSubmenuPointerDown,
  handleSubmenuMouseDown,
}: SessionFilterSubmenuPanelProps): React.ReactElement {
  const { t } = useTranslation("navigation");

  return (
    <DropdownPanel
      ref={submenuPanelRef}
      className={`${DROPDOWN_WIDTHS.panelWidthClass} fixed`}
      maxHeight="none"
      style={{ top: submenuAnchor.top, left: submenuAnchor.left }}
      data-testid={
        activeSubmenu === "groupBy"
          ? "sidebar-group-by-submenu"
          : activeSubmenu === "sort"
            ? "sidebar-sort-submenu"
            : "sidebar-show-submenu"
      }
      onPointerDown={handleSubmenuPointerDown}
      onMouseDown={handleSubmenuMouseDown}
    >
      <div className={DROPDOWN_CLASSES.itemsColumnPadded}>
        {activeSubmenu === "groupBy"
          ? groupByModes.map((mode) => (
              <DropdownItem
                key={mode}
                dataTestId={`sidebar-group-by-${mode}`}
                selected={mode === groupByMode}
                onClick={() => handleSelect(mode)}
              >
                {resolveGroupByLabel(mode)}
              </DropdownItem>
            ))
          : activeSubmenu === "sort"
            ? SESSION_SORT_MODES.map((mode) => (
                <DropdownItem
                  key={mode}
                  dataTestId={`sidebar-sort-${mode}`}
                  selected={mode === sortMode}
                  onClick={() => {
                    setSortMode(mode);
                  }}
                >
                  {t(`sidebar.sort.${mode}`)}
                </DropdownItem>
              ))
            : SESSION_GROUP_VISIBLE_COUNTS.map((count) => (
                <DropdownItem
                  key={count}
                  dataTestId={`sidebar-show-recent-${count}`}
                  selected={count === groupVisibleCount}
                  onClick={() => handleGroupVisibleCountSelect(count)}
                >
                  {t(`sidebar.show.recent${count}`)}
                </DropdownItem>
              ))}
      </div>
    </DropdownPanel>
  );
}
