import React, { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { CLOUD_REMOTE_ITEM_PREFIX } from "@src/features/Org2Cloud/cloudRemoteItemId";
import type { Org2CloudPresenceEntry } from "@src/features/Org2Cloud/org2CloudPresenceAtom";
import SessionHoverCard from "@src/features/SessionHoverCard";
import CloudSessionHoverCard from "@src/features/SessionHoverCard/CloudSessionHoverCard";
import type { NavigationMenuItem } from "@src/scaffold/NavigationSidebar/components/NavigationMenu/config";
import type { RemoteTeammateSessionMetadata } from "@src/store/collaboration/types";
import type { Session } from "@src/store/session";
import { isChatPanelTuiSessionId } from "@src/util/ui/terminal/chatPanelTuiSessionId";

export function useRenderSessionMenuItemWrapper(
  sessionMap: ReadonlyMap<string, Session>
): (item: NavigationMenuItem, node: React.ReactElement) => React.ReactElement {
  return useCallback(
    (item: NavigationMenuItem, node: React.ReactElement) => {
      if (!sessionMap.has(item.id) || isChatPanelTuiSessionId(item.id))
        return node;
      return (
        <SessionHoverCard
          key={item.key}
          sessionId={item.id}
          position="right-start"
          mouseEnterDelay={1000}
          mouseLeaveDelay={100}
        >
          {node}
        </SessionHoverCard>
      );
    },
    [sessionMap]
  );
}

interface UseRenderWorkstationMenuItemWrapperParams {
  cloudRemoteRowMap: ReadonlyMap<string, RemoteTeammateSessionMetadata>;
  cloudRemoteViewerMap: ReadonlyMap<string, readonly Org2CloudPresenceEntry[]>;
  renderSessionMenuItemWrapper: (
    item: NavigationMenuItem,
    node: React.ReactElement
  ) => React.ReactElement;
}

export function useRenderWorkstationMenuItemWrapper({
  cloudRemoteRowMap,
  cloudRemoteViewerMap,
  renderSessionMenuItemWrapper,
}: UseRenderWorkstationMenuItemWrapperParams): (
  item: NavigationMenuItem,
  node: React.ReactElement
) => React.ReactElement {
  const { t } = useTranslation("navigation");

  return useCallback(
    (item: NavigationMenuItem, node: React.ReactElement) => {
      if (!item.id.startsWith(CLOUD_REMOTE_ITEM_PREFIX)) {
        return renderSessionMenuItemWrapper(item, node);
      }
      if (item.disabled) {
        const metadataOnly =
          cloudRemoteRowMap.get(item.id)?.accessMode === "metadata_only";
        return (
          <div
            key={item.key}
            title={t(
              metadataOnly
                ? "cloud.sidebar.metadataOnly"
                : "cloud.sidebar.notPublished"
            )}
          >
            {node}
          </div>
        );
      }
      return (
        <CloudSessionHoverCard
          key={item.key}
          row={cloudRemoteRowMap.get(item.id)}
          viewers={cloudRemoteViewerMap.get(item.id)}
          position="right-start"
          mouseEnterDelay={1000}
          mouseLeaveDelay={100}
        >
          {node}
        </CloudSessionHoverCard>
      );
    },
    [cloudRemoteRowMap, cloudRemoteViewerMap, renderSessionMenuItemWrapper, t]
  );
}
