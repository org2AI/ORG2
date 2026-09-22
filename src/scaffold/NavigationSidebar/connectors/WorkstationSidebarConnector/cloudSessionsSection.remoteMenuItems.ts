/**
 * Native (secondary-click / ellipsis) menu for a Team Conversation row in
 * `useCloudSessionsSection`, plus the viewer-local pin state it toggles.
 */
import type { TFunction } from "i18next";
import { useCallback, useState } from "react";

import Message from "@src/components/Message";
import {
  isRemoteSessionPinned,
  readPinnedRemoteSessionIds,
  togglePinnedRemoteSession,
  writePinnedRemoteSessionIds,
} from "@src/features/Org2Cloud/cloudPinnedRemoteSessions";
import { parseCloudRemoteItemId } from "@src/features/Org2Cloud/cloudRemoteItemId";
import { buildCloudSessionReference } from "@src/features/Org2Cloud/cloudSessionReference";
import type { NavigationMenuItem } from "@src/scaffold/NavigationSidebar/components/NavigationMenu/config";
import type { RemoteTeammateSessionMetadata } from "@src/store/collaboration/types";
import { copyText } from "@src/util/data/clipboard";
import type { NativeMenuItemOptions } from "@src/util/platform/tauri/nativeMenuPopup";

import { buildCloudSessionNativeMenuItems } from "./cloudSessionNativeMenuItems";
import type { CloudSessionOpenHandlers } from "./cloudSessionsSection.openHandlers";

export interface CloudRemoteSessionMenuItems {
  pinnedRemoteSessionIds: Set<string>;
  toggleRemoteSessionPin: (orgId: string, rowId: string) => void;
  buildRemoteSessionMenuItems: (
    row: RemoteTeammateSessionMetadata
  ) => NativeMenuItemOptions[];
  buildCloudRemoteItemMenuItems: (
    item: NavigationMenuItem
  ) => NativeMenuItemOptions[];
}

export function useCloudRemoteSessionMenuItems({
  t,
  tCommon,
  tSessions,
  openTeamSessionAtDestination,
  hideRemoteSession,
  findRow,
}: {
  t: TFunction;
  tCommon: TFunction;
  tSessions: TFunction;
  openTeamSessionAtDestination: CloudSessionOpenHandlers["openTeamSessionAtDestination"];
  hideRemoteSession: (row: RemoteTeammateSessionMetadata) => void;
  findRow: (rowId: string) => RemoteTeammateSessionMetadata | undefined;
}): CloudRemoteSessionMenuItems {
  const [pinnedRemoteSessionIds, setPinnedRemoteSessionIds] = useState(
    readPinnedRemoteSessionIds
  );

  // A pin is the viewer's own view state: it never touches the shared cloud
  // row, and two viewers of the same session pin independently.
  const toggleRemoteSessionPin = useCallback((orgId: string, rowId: string) => {
    setPinnedRemoteSessionIds((current) => {
      const next = togglePinnedRemoteSession(current, orgId, rowId);
      writePinnedRemoteSessionIds(next);
      return next;
    });
  }, []);

  const buildRemoteSessionMenuItems = useCallback(
    (row: RemoteTeammateSessionMetadata) => {
      const isPinned = isRemoteSessionPinned(
        pinnedRemoteSessionIds,
        row.orgId,
        row.id
      );
      return buildCloudSessionNativeMenuItems({
        labels: {
          openInNewTab: tCommon("actions.openInNewTab"),
          openInNewWindow: tCommon("actions.openInNewWindow"),
          openInMyStation: tSessions("controlTower.sidebar.openInMyStation"),
          copyUrl: t("cloud.sidebar.copyUrl"),
          togglePin: isPinned
            ? tCommon("sessions:chat.unpinSession")
            : tCommon("sessions:chat.pinSession"),
          remove: tCommon("actions.remove"),
        },
        onOpenInNewTab: () => openTeamSessionAtDestination(row, "new-tab"),
        onOpenInNewWindow: () =>
          openTeamSessionAtDestination(row, "new-window"),
        onOpenInMyStation: () =>
          openTeamSessionAtDestination(row, "my-station"),
        onCopyUrl: () => {
          void copyText(buildCloudSessionReference(row))
            .then(() => {
              Message.success(tCommon("status.copied"));
            })
            .catch(() => {
              Message.error(tCommon("status.copyFailed"));
            });
        },
        onTogglePin: () => toggleRemoteSessionPin(row.orgId, row.id),
        onRemove: () => hideRemoteSession(row),
      });
    },
    [
      hideRemoteSession,
      openTeamSessionAtDestination,
      pinnedRemoteSessionIds,
      t,
      tCommon,
      tSessions,
      toggleRemoteSessionPin,
    ]
  );

  const buildCloudRemoteItemMenuItems = useCallback(
    (item: NavigationMenuItem) => {
      const parsed = parseCloudRemoteItemId(item.id);
      if (!parsed) return [];
      const row = findRow(parsed.rowId);
      if (!row || row.eventsEpoch === undefined) return [];
      return buildRemoteSessionMenuItems(row);
    },
    [buildRemoteSessionMenuItems, findRow]
  );

  return {
    pinnedRemoteSessionIds,
    toggleRemoteSessionPin,
    buildRemoteSessionMenuItems,
    buildCloudRemoteItemMenuItems,
  };
}
