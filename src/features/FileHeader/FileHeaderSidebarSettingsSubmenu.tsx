/**
 * FileHeaderSidebarSettingsSubmenu
 *
 * "Sidebar settings" flyout in the file header's more menu: WorkStation
 * primary-sidebar visibility, left/right location, tree indent lines, and
 * Source Control file-name colors.
 * Mounted only while the menu is open, so its atom subscriptions are too.
 */
import { useAtom } from "jotai";
import React from "react";
import { useTranslation } from "react-i18next";

import { ActionSubmenu } from "@src/components/Dropdown/ActionMenuSurface";
import {
  MenuSegmentedRow,
  MenuSwitchRow,
} from "@src/components/Dropdown/MenuControlRows";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_ITEM,
} from "@src/components/Dropdown/tokens";
import {
  SIDE_POSITION_OPTIONS,
  localizeMenuOptions,
} from "@src/config/appearance/quickMenuOptions";
import { usePrimarySidebarState } from "@src/hooks/tabHost/useWorkStationPanels";
import { HugeiconsIcon, SidebarLeftIcon, SidebarRightIcon } from "@src/icons";
import {
  editorShowTreeIndentGuidesAtom,
  gitSourceControlColorFileNamesAtom,
} from "@src/store/ui/editorSettingsAtom";
import type { LayoutMode } from "@src/store/ui/workStationLayout/splitLayoutAtoms";

export function FileHeaderSidebarSettingsSubmenu() {
  const { t } = useTranslation("common");
  const { t: tSettings } = useTranslation("settings");
  const {
    layoutMode,
    setLayoutMode,
    primarySidebarCollapsed,
    setPrimarySidebarCollapsed,
  } = usePrimarySidebarState();
  const [indentLinesEnabled, setIndentLinesEnabled] = useAtom(
    editorShowTreeIndentGuidesAtom
  );
  const [colorFileNames, setColorFileNames] = useAtom(
    gitSourceControlColorFileNamesAtom
  );
  const handleColorFileNamesChange = React.useCallback(
    (value: boolean) => {
      setColorFileNames(value).catch(() => undefined);
    },
    [setColorFileNames]
  );

  return (
    <ActionSubmenu
      label={t("sidebarSettings.title")}
      icon={
        <HugeiconsIcon
          icon={layoutMode === "right" ? SidebarRightIcon : SidebarLeftIcon}
          size={DROPDOWN_ITEM.iconSize}
          strokeWidth={1.75}
        />
      }
      dataTestId="file-header-sidebar-settings-submenu"
    >
      <MenuSwitchRow
        label={t("sidebarSettings.showSidebar")}
        checked={!primarySidebarCollapsed}
        onCheckedChange={(visible) => setPrimarySidebarCollapsed(!visible)}
        dataTestId="file-header-sidebar-visible-toggle"
      />
      <MenuSegmentedRow<LayoutMode>
        label={t("layoutSettings.sidebarPosition")}
        dataTestId="file-header-sidebar-location"
        value={layoutMode}
        options={localizeMenuOptions(SIDE_POSITION_OPTIONS, t)}
        onChange={setLayoutMode}
      />
      <div
        role="separator"
        aria-hidden
        className={DROPDOWN_CLASSES.menuGroupSeparator}
        data-testid="file-header-sidebar-indent-lines-separator"
      />
      <MenuSwitchRow
        label={tSettings("editor.treeIndentGuides")}
        checked={indentLinesEnabled}
        onCheckedChange={setIndentLinesEnabled}
        dataTestId="file-header-sidebar-indent-lines-toggle"
      />
      <MenuSwitchRow
        label={t("sidebarSettings.colorSourceControlFiles")}
        checked={colorFileNames}
        onCheckedChange={handleColorFileNamesChange}
        dataTestId="file-header-sidebar-diff-colors-toggle"
      />
    </ActionSubmenu>
  );
}
