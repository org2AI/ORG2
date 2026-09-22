/** View-owned channel presentation joins the application-owned cloud session roster. */
import { useCallback, useMemo } from "react";

import type { NavigationMenuItem } from "@src/scaffold/NavigationSidebar/components/NavigationMenu/config";

import type { SidebarTabDisposition } from "../sidebarTabNavigation";
import type { useCloudSessionsSection } from "./cloudSessionsSection";
import { useChannelsSidebarSurface } from "./useChannelsSidebarSurface";

interface UseWorkstationSidebarCloudMenuDataParams {
  activeCloudOrgId: string | null;
  cloudSection: ReturnType<typeof useCloudSessionsSection>;
}

export function mergeCloudSidebarSections(
  channelsMenuItems: readonly NavigationMenuItem[],
  cloudSessionMenuItems: readonly NavigationMenuItem[]
): NavigationMenuItem[] {
  return channelsMenuItems.length === 0
    ? [...cloudSessionMenuItems]
    : [...channelsMenuItems, ...cloudSessionMenuItems];
}

export function useWorkstationSidebarCloudMenuData({
  activeCloudOrgId,
  cloudSection,
}: UseWorkstationSidebarCloudMenuDataParams) {
  const {
    cloudMenuItems,
    selectedCloudMenuItemId,
    handleCloudSessionItemClick,
    resetCloudTeamPagination,
    buildCloudRemoteItemMenuItems,
    cloudRemoteRowMap,
    cloudRemoteViewerMap,
  } = cloudSection;

  const channels = useChannelsSidebarSurface(activeCloudOrgId);

  // Channels lead Team Sessions; the My Sessions separator is appended
  // downstream by buildCloudScopedMenuItems.
  const mergedCloudMenuItems = useMemo(
    () => mergeCloudSidebarSections(channels.cloudMenuItems, cloudMenuItems),
    [channels.cloudMenuItems, cloudMenuItems]
  );

  // Channel rows resolve first: their ids can never collide with
  // `cloudremote-` / pagination ids, so an early claim is unambiguous.
  const { handleItemClick: handleChannelsItemClick } = channels;
  const handleCloudScopedItemClick = useCallback(
    (item: NavigationMenuItem, disposition: SidebarTabDisposition): boolean =>
      handleChannelsItemClick(item, disposition) ||
      handleCloudSessionItemClick(item, disposition),
    [handleChannelsItemClick, handleCloudSessionItemClick]
  );

  return {
    cloudMenuItems: mergedCloudMenuItems,
    cloudSessionMenuItems: cloudMenuItems,
    channelMenuItems: channels.menuItems,
    // An open channel surface wins over the team-sessions selection: it is
    // the tab the pane is actually showing.
    selectedCloudMenuItemId:
      channels.selectedMenuItemId ?? selectedCloudMenuItemId,
    handleCloudSessionItemClick: handleCloudScopedItemClick,
    resetCloudTeamPagination,
    buildCloudRemoteItemMenuItems,
    cloudRemoteRowMap,
    cloudRemoteViewerMap,
    cloudChannelsDialogs: channels.cloudDialogs,
    localChannelsDialogs: channels.localDialogs,
  };
}
