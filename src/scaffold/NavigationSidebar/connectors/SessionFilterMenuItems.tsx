import React from "react";
import { useTranslation } from "react-i18next";

import { DropdownItem } from "@src/components/Dropdown/exports";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_ITEM,
} from "@src/components/Dropdown/tokens";
import Switch from "@src/components/Switch";
import {
  ArrowRight01Icon,
  ArrowUpDownIcon,
  ArrowUpRight01Icon,
  FolderInputIcon,
  FolderOutputIcon,
  FolderSymlinkIcon,
  HugeiconsIcon,
  Layers01Icon,
  ListChevronsDownUpIcon,
  Refresh04Icon,
  SlidersHorizontalIcon,
  TickDouble01Icon,
  ViewIcon,
} from "@src/icons";

import type {
  SessionFilterButtonProps,
  SessionFilterSubmenu,
} from "./sessionFilterTypes";
import type { SessionSortMode } from "./sidebarSessionOrder";
import type { SessionGroupVisibleCount } from "./types";

interface SessionFilterSubmenuTriggersProps {
  groupTriggerRef: React.RefObject<HTMLDivElement | null>;
  sortTriggerRef: React.RefObject<HTMLDivElement | null>;
  visibleCountTriggerRef: React.RefObject<HTMLDivElement | null>;
  activeSubmenu: SessionFilterSubmenu | null;
  groupByMode: string;
  sortMode: SessionSortMode;
  groupVisibleCount: SessionGroupVisibleCount;
  resolveGroupByLabel: (mode: string) => string;
  handleSubmenuTriggerEnter: (submenu: SessionFilterSubmenu) => void;
  handleSubmenuTriggerClick: (submenu: SessionFilterSubmenu) => void;
}

/** Group by, Sort and Show: first-level rows naming the value their submenu sets. */
export function SessionFilterSubmenuTriggers({
  groupTriggerRef,
  sortTriggerRef,
  visibleCountTriggerRef,
  activeSubmenu,
  groupByMode,
  sortMode,
  groupVisibleCount,
  resolveGroupByLabel,
  handleSubmenuTriggerEnter,
  handleSubmenuTriggerClick,
}: SessionFilterSubmenuTriggersProps): React.ReactElement {
  const { t } = useTranslation("navigation");

  return (
    <>
      <DropdownItem
        ref={groupTriggerRef}
        dataTestId="sidebar-group-by-trigger"
        className={
          activeSubmenu === "groupBy" ? DROPDOWN_CLASSES.itemActive : ""
        }
        icon={
          <HugeiconsIcon
            icon={Layers01Icon}
            data-icon="layers"
            size={DROPDOWN_ITEM.iconSize}
            strokeWidth={2}
          />
        }
        suffix={
          <span className="flex items-center gap-1">
            <span className="text-text-3">
              {resolveGroupByLabel(groupByMode)}
            </span>
            <HugeiconsIcon
              icon={ArrowRight01Icon}
              data-icon="chevron-right"
              size={DROPDOWN_ITEM.iconSize}
              strokeWidth={2}
              className="text-text-3"
            />
          </span>
        }
        ariaHasPopup="menu"
        ariaExpanded={activeSubmenu === "groupBy"}
        onMouseEnter={() => handleSubmenuTriggerEnter("groupBy")}
        onClick={() => handleSubmenuTriggerClick("groupBy")}
      >
        {t("sidebar.groupBy.title")}
      </DropdownItem>
      <DropdownItem
        ref={sortTriggerRef}
        dataTestId="sidebar-sort-trigger"
        icon={
          <HugeiconsIcon
            icon={ArrowUpDownIcon}
            data-icon="arrow-up-down"
            size={DROPDOWN_ITEM.iconSize}
            strokeWidth={2}
          />
        }
        ariaHasPopup="menu"
        ariaExpanded={activeSubmenu === "sort"}
        onMouseEnter={() => handleSubmenuTriggerEnter("sort")}
        onClick={() => handleSubmenuTriggerClick("sort")}
        suffix={
          <span className="flex items-center gap-1 text-text-3">
            {t(`sidebar.sort.${sortMode}`)}
            <HugeiconsIcon
              icon={ArrowRight01Icon}
              size={DROPDOWN_ITEM.iconSize}
            />
          </span>
        }
      >
        {t("sidebar.sort.title")}
      </DropdownItem>
      <DropdownItem
        ref={visibleCountTriggerRef}
        dataTestId="sidebar-show-trigger"
        className={
          activeSubmenu === "visibleCount" ? DROPDOWN_CLASSES.itemActive : ""
        }
        icon={
          <HugeiconsIcon
            icon={ViewIcon}
            data-icon="view"
            size={DROPDOWN_ITEM.iconSize}
            strokeWidth={2}
          />
        }
        suffix={
          <span className="flex items-center gap-1">
            <span className="text-text-3">
              {t(`sidebar.show.recent${groupVisibleCount}`)}
            </span>
            <HugeiconsIcon
              icon={ArrowRight01Icon}
              data-icon="chevron-right"
              size={DROPDOWN_ITEM.iconSize}
              strokeWidth={2}
              className="text-text-3"
            />
          </span>
        }
        ariaHasPopup="menu"
        ariaExpanded={activeSubmenu === "visibleCount"}
        onMouseEnter={() => handleSubmenuTriggerEnter("visibleCount")}
        onClick={() => handleSubmenuTriggerClick("visibleCount")}
      >
        {t("sidebar.show.title")}
      </DropdownItem>
    </>
  );
}

interface SessionFilterActionItemsProps extends Pick<
  SessionFilterButtonProps,
  | "includeExternal"
  | "onToggleIncludeExternal"
  | "onConfigureExternalSources"
  | "onCollapseAll"
  | "onMarkAllRead"
  | "onRefreshSessions"
  | "onExportSessionJson"
  | "onImportSessionJson"
> {
  canExportSessionJson: boolean;
  closeSubmenu: () => void;
  handleConfigureExternalSources: () => void;
  handleCollapseAll: () => void;
  handleMarkAllRead: () => void;
  handleRefreshSessions: () => void;
  handleExportSessionJson: () => void;
  handleImportSessionJson: () => void;
}

/** Include External, the optional list actions, and Manage external sources. */
export function SessionFilterActionItems({
  includeExternal,
  onToggleIncludeExternal,
  onConfigureExternalSources,
  onCollapseAll,
  onMarkAllRead,
  onRefreshSessions,
  onExportSessionJson,
  onImportSessionJson,
  canExportSessionJson,
  closeSubmenu,
  handleConfigureExternalSources,
  handleCollapseAll,
  handleMarkAllRead,
  handleRefreshSessions,
  handleExportSessionJson,
  handleImportSessionJson,
}: SessionFilterActionItemsProps): React.ReactElement {
  const { t } = useTranslation("navigation");
  const { t: tCommon } = useTranslation("common");

  const hasExtraActions = Boolean(
    onCollapseAll ||
    onMarkAllRead ||
    onRefreshSessions ||
    onExportSessionJson ||
    onImportSessionJson
  );

  return (
    <>
      <DropdownItem
        dataTestId="sidebar-include-external"
        role="none"
        hoverable={false}
        suffix={
          <span
            className="flex items-center"
            onKeyDown={(event) => event.stopPropagation()}
          >
            <Switch
              size="small"
              checked={includeExternal}
              onCheckedChange={onToggleIncludeExternal}
              ariaLabel={t("sidebar.filters.includeExternal")}
            />
          </span>
        }
        icon={
          <HugeiconsIcon
            icon={FolderSymlinkIcon}
            data-icon="folder-symlink"
            size={DROPDOWN_ITEM.iconSize}
            strokeWidth={2}
          />
        }
        onMouseEnter={closeSubmenu}
      >
        {t("sidebar.filters.includeExternal")}
      </DropdownItem>
      {hasExtraActions && (
        <>
          <div className={DROPDOWN_CLASSES.menuGroupSeparator} />
          {onRefreshSessions && (
            <DropdownItem
              dataTestId="sidebar-refresh-sessions"
              icon={
                <HugeiconsIcon
                  icon={Refresh04Icon}
                  data-icon="refresh-cw"
                  size={DROPDOWN_ITEM.iconSize}
                  strokeWidth={2}
                />
              }
              onMouseEnter={closeSubmenu}
              onClick={handleRefreshSessions}
            >
              {tCommon("actions.refresh")}
            </DropdownItem>
          )}
          {onExportSessionJson && (
            <DropdownItem
              icon={
                <HugeiconsIcon
                  icon={FolderOutputIcon}
                  data-icon="folder-output"
                  size={DROPDOWN_ITEM.iconSize}
                  strokeWidth={2}
                />
              }
              disabled={!canExportSessionJson}
              onMouseEnter={closeSubmenu}
              onClick={handleExportSessionJson}
            >
              {tCommon("sessions:chat.importExport.exportAction")}
            </DropdownItem>
          )}
          {onImportSessionJson && (
            <DropdownItem
              icon={
                <HugeiconsIcon
                  icon={FolderInputIcon}
                  data-icon="folder-input"
                  size={DROPDOWN_ITEM.iconSize}
                  strokeWidth={2}
                />
              }
              onMouseEnter={closeSubmenu}
              onClick={handleImportSessionJson}
            >
              {tCommon("sessions:chat.importExport.importAction")}
            </DropdownItem>
          )}
          {onCollapseAll && (
            <DropdownItem
              icon={
                <HugeiconsIcon
                  icon={ListChevronsDownUpIcon}
                  data-icon="list-chevrons-down-up"
                  size={DROPDOWN_ITEM.iconSize}
                  strokeWidth={2}
                />
              }
              onMouseEnter={closeSubmenu}
              onClick={handleCollapseAll}
            >
              {t("sidebar.actions.collapseAll")}
            </DropdownItem>
          )}
          {onMarkAllRead && (
            <DropdownItem
              icon={
                <HugeiconsIcon
                  icon={TickDouble01Icon}
                  data-icon="check-check"
                  size={DROPDOWN_ITEM.iconSize}
                  strokeWidth={2}
                />
              }
              onMouseEnter={closeSubmenu}
              onClick={handleMarkAllRead}
            >
              {t("sidebar.actions.markAllRead")}
            </DropdownItem>
          )}
        </>
      )}
      {onConfigureExternalSources && (
        <>
          {/* Last section, on its own: unlike every item above —
              which acts on this list in place — it leaves the menu
              for Runtime → Scanning. The trailing arrow says so. */}
          <div className={DROPDOWN_CLASSES.menuGroupSeparator} />
          <DropdownItem
            dataTestId="sidebar-configure-external-sources"
            icon={
              <HugeiconsIcon
                icon={SlidersHorizontalIcon}
                data-icon="sliders-horizontal"
                size={DROPDOWN_ITEM.iconSize}
                strokeWidth={2}
              />
            }
            suffix={
              <HugeiconsIcon
                icon={ArrowUpRight01Icon}
                data-icon="arrow-up-right"
                size={DROPDOWN_ITEM.iconSize}
                strokeWidth={2}
                className="text-text-3"
              />
            }
            onMouseEnter={closeSubmenu}
            onClick={handleConfigureExternalSources}
          >
            {t("sidebar.filters.manageExternalSources")}
          </DropdownItem>
        </>
      )}
    </>
  );
}
