/**
 * TabBarPlusMenu
 *
 * Trailing `+` button for the unified workstation tab bar. The action model is
 * shared with the empty-pool Launchpad through `useWorkStationLaunchActions`,
 * while the extracted item renderer keeps this coordinator focused on menu
 * state.
 */
import { useAtomValue, useSetAtom } from "jotai";
import React, { memo, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import Dropdown from "@src/components/Dropdown";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_WIDTHS,
} from "@src/components/Dropdown/tokens";
import { RecentTabsMenuSection } from "@src/components/RecentTabsMenuSection";
import { TabBarTrailingIconButton } from "@src/components/TabPill/TabBarTrailingIconButton";
import { HEADER_ICON_SIZE } from "@src/config/workstation/tokens";
import { Add01Icon, HugeiconsIcon } from "@src/icons";
import {
  LAUNCHPAD_ACTION_IDS,
  useWorkStationLaunchActions,
} from "@src/modules/WorkStation/AppShell/useWorkStationLaunchActions";
import { WorkstationTabIcon } from "@src/modules/WorkStation/shared/TabBar/components/WorkstationTabIcon";
import { CODE_EDITOR_TOUR_TARGETS } from "@src/scaffold/Tutorials/codeEditorTourConfig";
import {
  openRecentWorkstationTabAtom,
  recentWorkstationTabsAtom,
} from "@src/store/workstation";
import { shouldShowInRecentTabsMenu } from "@src/util/tabs/recentTabsMenu";

import { TabBarPlusMenuItems } from "./TabBarPlusMenuItems";

const WORKSTATION_NEW_TAB_EVENT = "workstation-new-tab";

const TabBarPlusMenuComponent: React.FC = () => {
  const { t } = useTranslation("navigation");
  const actions = useWorkStationLaunchActions();
  const [menuVisible, setMenuVisible] = useState(false);
  const recentTabs = useAtomValue(recentWorkstationTabsAtom);
  const openRecentTab = useSetAtom(openRecentWorkstationTabAtom);

  // ⌘T (`new_tab`) is exclusively bound to opening this menu. Only one
  // TabBarPlusMenu is mounted at a time per surface, so there is no double-fire.
  useEffect(() => {
    const handler = () => setMenuVisible((open) => !open);
    window.addEventListener(WORKSTATION_NEW_TAB_EVENT, handler);
    return () => window.removeEventListener(WORKSTATION_NEW_TAB_EVENT, handler);
  }, []);

  // The menu shows the full launcher palette.
  const visibleActions = useMemo(
    () => actions.filter((action) => LAUNCHPAD_ACTION_IDS.includes(action.id)),
    [actions]
  );
  const visibleRecentTabs = useMemo(
    () => recentTabs.filter(shouldShowInRecentTabsMenu),
    [recentTabs]
  );
  const triggerLabel = t("workstation.plusMenu.title");
  const droplist = (
    <div
      className={`${DROPDOWN_CLASSES.menuPanelBase} ${DROPDOWN_WIDTHS.sidebarMenuClass}`}
    >
      <div className={DROPDOWN_CLASSES.itemsColumn}>
        <TabBarPlusMenuItems
          actions={visibleActions}
          onActionComplete={() => setMenuVisible(false)}
        />
        <RecentTabsMenuSection
          tabs={visibleRecentTabs.map((tab) => ({
            id: tab.id,
            title: tab.title,
            leadingIcon: <WorkstationTabIcon tab={tab} isActive={false} />,
          }))}
          label={t("workstation.plusMenu.recent")}
          onOpen={(tabId) => {
            setMenuVisible(false);
            openRecentTab(tabId);
          }}
        />
      </div>
    </div>
  );

  return (
    <Dropdown
      droplist={droplist}
      position="bottom-end"
      trigger="click"
      popupVisible={menuVisible}
      onVisibleChange={setMenuVisible}
      getPopupContainer={() => document.body}
      avoidViewportOverflow
    >
      <span
        className="inline-flex"
        data-tour-target={CODE_EDITOR_TOUR_TARGETS.plusMenu}
      >
        <TabBarTrailingIconButton
          title={triggerLabel}
          shortcutId="new_tab"
          tooltipDisabled={menuVisible}
          active={menuVisible}
          className="shrink-0"
        >
          <HugeiconsIcon
            icon={Add01Icon}
            data-icon="plus"
            size={HEADER_ICON_SIZE.md}
            strokeWidth={2}
          />
        </TabBarTrailingIconButton>
      </span>
    </Dropdown>
  );
};

export const TabBarPlusMenu = memo(TabBarPlusMenuComponent);
TabBarPlusMenu.displayName = "TabBarPlusMenu";
