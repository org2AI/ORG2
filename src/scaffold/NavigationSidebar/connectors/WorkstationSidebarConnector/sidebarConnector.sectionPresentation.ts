import { type SetStateAction, useCallback, useMemo } from "react";

import type { NavigationMenuItem } from "@src/scaffold/NavigationSidebar/components/NavigationMenu/config";

import { NEW_SESSION_MENU_ITEM_ID } from "../sidebarConnectorUtils";
import type { SessionSidebarView } from "./types";

interface UseSectionPresentationParams {
  activeViewKey: SessionSidebarView;
  pinnedMenuItems: NavigationMenuItem[];
  workItemsMenuItems: NavigationMenuItem[];
  channelMenuItems: NavigationMenuItem[];
  sessionMenuItems: NavigationMenuItem[];
  workItemsContentVisible: boolean;
  workItemsCollapsedSectionIds: Set<string>;
  collapsedSectionIds: Set<string>;
  customSectionHeaders: readonly NavigationMenuItem[];
  setSavedCustomCollapsed: (value: SetStateAction<string[]>) => void;
  handleSessionCollapsedSectionIdsChange: (ids: Set<string>) => void;
}

export function useWorkstationSidebarSectionPresentation({
  activeViewKey,
  pinnedMenuItems,
  workItemsMenuItems,
  channelMenuItems,
  sessionMenuItems,
  workItemsContentVisible,
  workItemsCollapsedSectionIds,
  collapsedSectionIds,
  customSectionHeaders,
  setSavedCustomCollapsed,
  handleSessionCollapsedSectionIdsChange,
}: UseSectionPresentationParams) {
  const resolvedSidebarMenuItems = workItemsContentVisible
    ? workItemsMenuItems
    : activeViewKey === "channels"
      ? channelMenuItems
      : sessionMenuItems;

  const sidebarScrollLayout = useMemo(() => {
    if (activeViewKey !== "sessions") {
      return { pinnedMenuItems, menuItems: resolvedSidebarMenuItems };
    }
    return {
      pinnedMenuItems: pinnedMenuItems.filter(
        (item) => item.id === NEW_SESSION_MENU_ITEM_ID
      ),
      menuItems: [
        ...pinnedMenuItems.filter(
          (item) => item.id !== NEW_SESSION_MENU_ITEM_ID
        ),
        ...resolvedSidebarMenuItems,
      ],
    };
  }, [activeViewKey, pinnedMenuItems, resolvedSidebarMenuItems]);

  const resolvedCollapsedSectionIds = workItemsContentVisible
    ? workItemsCollapsedSectionIds
    : collapsedSectionIds;

  const resolvedOnCollapsedSectionIdsChange = useCallback(
    (ids: Set<string>) => {
      if (workItemsContentVisible) {
        handleSessionCollapsedSectionIdsChange(ids);
        return;
      }
      setSavedCustomCollapsed(
        [...ids].filter((id) =>
          customSectionHeaders.some((header) => header.id === `separator-${id}`)
        )
      );
      handleSessionCollapsedSectionIdsChange(ids);
    },
    [
      customSectionHeaders,
      handleSessionCollapsedSectionIdsChange,
      setSavedCustomCollapsed,
      workItemsContentVisible,
    ]
  );

  return {
    sidebarScrollLayout,
    resolvedCollapsedSectionIds,
    resolvedOnCollapsedSectionIdsChange,
    resolvedSidebarMenuItems,
  };
}
