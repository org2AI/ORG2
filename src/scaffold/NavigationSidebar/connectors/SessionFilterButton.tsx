import { useAtom } from "jotai";
import React, { type FC, useCallback } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { DropdownPanel } from "@src/components/Dropdown/exports";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_WIDTHS,
} from "@src/components/Dropdown/tokens";

import {
  SessionFilterActionItems,
  SessionFilterSubmenuTriggers,
} from "./SessionFilterMenuItems";
import { SessionFilterSubmenuPanel } from "./SessionFilterSubmenuPanel";
import { SessionFilterTrigger } from "./SessionFilterTrigger";
import type { SessionFilterButtonProps } from "./sessionFilterTypes";
import { sidebarSessionSortAtom } from "./sidebarSessionOrder";
import { GROUP_BY_MODES } from "./types";
import { useSessionFilterActions } from "./useSessionFilterActions";
import { useSessionFilterMenu } from "./useSessionFilterMenu";

export const SessionFilterButton: FC<SessionFilterButtonProps> = React.memo(
  ({
    groupByMode,
    groupVisibleCount,
    includeExternal,
    onSelect,
    onSelectGroupVisibleCount,
    onToggleIncludeExternal,
    onConfigureExternalSources,
    onCollapseAll,
    onMarkAllRead,
    onRefreshSessions,
    onExportSessionJson,
    onImportSessionJson,
    canExportSessionJson = true,
  }) => {
    const { t } = useTranslation("navigation");
    // Multi-choice settings live one level down, while every other row here
    // acts on the list immediately. Keeping their options out of the first
    // level keeps the actions readable and still shows each current value.
    const [sortMode, setSortMode] = useAtom(sidebarSessionSortAtom);
    const {
      isOpen,
      isPositioned,
      toggle,
      close,
      triggerRef,
      panelRef,
      panelPosition,
      sortTriggerRef,
      groupTriggerRef,
      visibleCountTriggerRef,
      submenuPanelRef,
      activeSubmenu,
      submenuAnchor,
      closeSubmenu,
      handleSubmenuTriggerEnter,
      handleSubmenuTriggerClick,
      handleSubmenuPointerDown,
      handleSubmenuMouseDown,
    } = useSessionFilterMenu();

    const {
      handleSelect,
      handleGroupVisibleCountSelect,
      handleConfigureExternalSources,
      handleCollapseAll,
      handleMarkAllRead,
      handleRefreshSessions,
      handleExportSessionJson,
      handleImportSessionJson,
    } = useSessionFilterActions({
      onSelect,
      onSelectGroupVisibleCount,
      onConfigureExternalSources,
      onCollapseAll,
      onMarkAllRead,
      onRefreshSessions,
      onExportSessionJson,
      onImportSessionJson,
      close,
    });

    const resolveGroupByLabel = useCallback(
      (mode: string) => t(`sidebar.groupBy.${mode}`),
      [t]
    );

    return (
      <>
        <SessionFilterTrigger
          isOpen={isOpen}
          toggle={toggle}
          triggerRef={triggerRef}
        />

        {isOpen &&
          isPositioned &&
          createPortal(
            <DropdownPanel
              ref={panelRef}
              className={`${DROPDOWN_WIDTHS.sidebarMenuClass} fixed`}
              maxHeight="none"
              style={{
                top: panelPosition.top,
                bottom: panelPosition.bottom,
                left: panelPosition.left,
              }}
            >
              <div className={DROPDOWN_CLASSES.itemsColumnPadded}>
                <SessionFilterSubmenuTriggers
                  groupTriggerRef={groupTriggerRef}
                  sortTriggerRef={sortTriggerRef}
                  visibleCountTriggerRef={visibleCountTriggerRef}
                  activeSubmenu={activeSubmenu}
                  groupByMode={groupByMode}
                  sortMode={sortMode}
                  groupVisibleCount={groupVisibleCount}
                  resolveGroupByLabel={resolveGroupByLabel}
                  handleSubmenuTriggerEnter={handleSubmenuTriggerEnter}
                  handleSubmenuTriggerClick={handleSubmenuTriggerClick}
                />
                <div className={DROPDOWN_CLASSES.menuGroupSeparator} />
                <SessionFilterActionItems
                  includeExternal={includeExternal}
                  onToggleIncludeExternal={onToggleIncludeExternal}
                  onConfigureExternalSources={onConfigureExternalSources}
                  onCollapseAll={onCollapseAll}
                  onMarkAllRead={onMarkAllRead}
                  onRefreshSessions={onRefreshSessions}
                  onExportSessionJson={onExportSessionJson}
                  onImportSessionJson={onImportSessionJson}
                  canExportSessionJson={canExportSessionJson}
                  closeSubmenu={closeSubmenu}
                  handleConfigureExternalSources={
                    handleConfigureExternalSources
                  }
                  handleCollapseAll={handleCollapseAll}
                  handleMarkAllRead={handleMarkAllRead}
                  handleRefreshSessions={handleRefreshSessions}
                  handleExportSessionJson={handleExportSessionJson}
                  handleImportSessionJson={handleImportSessionJson}
                />
              </div>
            </DropdownPanel>,
            document.body
          )}

        {isOpen &&
          activeSubmenu &&
          submenuAnchor &&
          createPortal(
            <SessionFilterSubmenuPanel
              submenuPanelRef={submenuPanelRef}
              activeSubmenu={activeSubmenu}
              submenuAnchor={submenuAnchor}
              groupByModes={GROUP_BY_MODES}
              groupByMode={groupByMode}
              sortMode={sortMode}
              setSortMode={setSortMode}
              groupVisibleCount={groupVisibleCount}
              resolveGroupByLabel={resolveGroupByLabel}
              handleSelect={handleSelect}
              handleGroupVisibleCountSelect={handleGroupVisibleCountSelect}
              handleSubmenuPointerDown={handleSubmenuPointerDown}
              handleSubmenuMouseDown={handleSubmenuMouseDown}
            />,
            document.body
          )}
      </>
    );
  }
);

SessionFilterButton.displayName = "SessionFilterButton";
