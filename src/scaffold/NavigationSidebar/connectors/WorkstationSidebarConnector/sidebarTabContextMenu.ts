import { type MouseEvent, useCallback } from "react";

import { CLOUD_REMOTE_ITEM_PREFIX } from "@src/features/Org2Cloud/cloudRemoteItemId";
import { createLogger } from "@src/hooks/logger";
import { AppWindowMacIcon, CursorInWindowIcon } from "@src/icons";
import type { NavigationMenuItem } from "@src/scaffold/NavigationSidebar/components/NavigationMenu/config";
import { popupSidebarMenu } from "@src/scaffold/NavigationSidebar/menus/SidebarMenu";
import { type SidebarMenuItem } from "@src/scaffold/NavigationSidebar/menus/types";
import type { Session } from "@src/store/session";

import { isDraftMenuItemId } from "../sidebarConnectorUtils";

const log = createLogger("WorkstationSidebarTabContextMenu");

interface UseSidebarTabContextMenuParams {
  sessionMap: ReadonlyMap<string, Session>;
  fallback: (
    event: MouseEvent,
    key: string,
    item: NavigationMenuItem
  ) => Promise<void>;
  onOpenInNewTab: (key: string, item: NavigationMenuItem) => void;
  openInNewTabLabel: string;
  openInLabel: string;
}

export function buildOpenSidebarItemInNewTabMenuItem({
  label,
  onOpen,
}: {
  label: string;
  onOpen: () => void;
}): SidebarMenuItem {
  return { text: label, icon: AppWindowMacIcon, action: onOpen };
}

/**
 * Add link-like new-tab behavior to chat-panel destinations while preserving
 * the richer conversation/draft menus owned by the session controller.
 */
export function useSidebarTabContextMenu({
  sessionMap,
  fallback,
  onOpenInNewTab,
  openInNewTabLabel,
  openInLabel,
}: UseSidebarTabContextMenuParams) {
  return useCallback(
    async (event: MouseEvent, key: string, item: NavigationMenuItem) => {
      const sessionMenuOwnsItem =
        sessionMap.has(item.id) ||
        isDraftMenuItemId(item.id) ||
        item.id.startsWith(CLOUD_REMOTE_ITEM_PREFIX);
      if (sessionMenuOwnsItem) {
        await fallback(event, key, item);
        return;
      }
      if (!item.opensChatPanelTab) return;

      event.preventDefault();
      event.stopPropagation();
      try {
        await popupSidebarMenu(event, {
          source: "workstation-sidebar-tab-row",
          buildItems: () => [
            {
              text: openInLabel,
              icon: CursorInWindowIcon,
              items: [
                buildOpenSidebarItemInNewTabMenuItem({
                  label: openInNewTabLabel,
                  onOpen: () => onOpenInNewTab(key, item),
                }),
              ],
            },
          ],
        });
      } catch (error) {
        log.error("[WorkstationSidebar] Tab context menu failed:", error);
      }
    },
    [fallback, onOpenInNewTab, openInLabel, openInNewTabLabel, sessionMap]
  );
}
