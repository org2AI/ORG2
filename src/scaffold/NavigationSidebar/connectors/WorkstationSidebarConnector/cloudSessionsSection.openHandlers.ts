/**
 * Open/click handlers for `useCloudSessionsSection`: placing a Team
 * Conversation on a requested surface (own local original, in-flight replay,
 * or a fresh replay) and the row/pagination click resolver built on it.
 */
import type { Dispatch, SetStateAction } from "react";
import { useCallback } from "react";

import { parseCloudRemoteItemId } from "@src/features/Org2Cloud/cloudRemoteItemId";
import type { CloudSessionBusyEntry } from "@src/features/Org2Cloud/cloudSessionBusyAtom";
import type { CloudSessionReplayOptions } from "@src/features/Org2Cloud/useCloudSessionActions";
import type { NavigationMenuItem } from "@src/scaffold/NavigationSidebar/components/NavigationMenu/config";
import type { RemoteTeammateSessionMetadata } from "@src/store/collaboration/types";

import type { SidebarTabDisposition } from "../sidebarTabNavigation";
import type { SessionGroupVisibleCount } from "../types";
import { CLOUD_TEAM_SESSIONS_LOAD_MORE_ID } from "./cloudScopedMenuItems";
import type { CloudTeamPaginationState } from "./cloudSessionsSection.threadModel";
import type { UseCloudSessionsSectionParams } from "./cloudSessionsSection.types";

export interface CloudSessionOpenHandlers {
  openTeamSessionAtDestination: (
    row: RemoteTeammateSessionMetadata,
    destination: SidebarTabDisposition | "my-station" | "new-window"
  ) => void;
  handleCloudSessionItemClick: (
    item: NavigationMenuItem,
    disposition: SidebarTabDisposition
  ) => boolean;
}

export function useCloudSessionOpenHandlers({
  selfUserId,
  localOwnSessionIds,
  busySessionRows,
  openSessionAtDestination,
  runReplay,
  findRow,
  teamPaginationScopeKey,
  groupVisibleCount,
  setTeamPagination,
}: {
  selfUserId: string | null;
  localOwnSessionIds: ReadonlySet<string>;
  busySessionRows: ReadonlyMap<string, CloudSessionBusyEntry>;
  openSessionAtDestination: UseCloudSessionsSectionParams["openSessionAtDestination"];
  runReplay: (
    row: RemoteTeammateSessionMetadata,
    options?: CloudSessionReplayOptions
  ) => void;
  findRow: (rowId: string) => RemoteTeammateSessionMetadata | undefined;
  teamPaginationScopeKey: string;
  groupVisibleCount: SessionGroupVisibleCount;
  setTeamPagination: Dispatch<SetStateAction<CloudTeamPaginationState>>;
}): CloudSessionOpenHandlers {
  const openTeamSessionAtDestination = useCallback(
    (
      row: RemoteTeammateSessionMetadata,
      destination: SidebarTabDisposition | "my-station" | "new-window"
    ) => {
      const openLocalSession = (sessionId: string) => {
        openSessionAtDestination(destination, {
          sessionId,
          title: row.title,
        });
      };

      // A viewer's own row in a multi-owner conversation remains the writable
      // local original. Never mint a read-only imported copy for it.
      if (
        row.ownerUserId === selfUserId &&
        localOwnSessionIds.has(row.sourceSessionId)
      ) {
        openLocalSession(row.sourceSessionId);
        return;
      }

      // A replay already in flight has already chosen its deterministic local
      // id. The destination action should still work instead of becoming a
      // dead menu item while the transcript downloads.
      const busy = busySessionRows.get(row.id);
      if (busy) {
        if (busy.kind === "replay" && busy.localSessionId) {
          openLocalSession(busy.localSessionId);
        }
        return;
      }

      runReplay(row, {
        openSurface: ({ localSessionId }) => openLocalSession(localSessionId),
      });
    },
    [
      busySessionRows,
      localOwnSessionIds,
      openSessionAtDestination,
      runReplay,
      selfUserId,
    ]
  );

  const handleCloudSessionItemClick = useCallback(
    (item: NavigationMenuItem, disposition: SidebarTabDisposition): boolean => {
      if (item.id === CLOUD_TEAM_SESSIONS_LOAD_MORE_ID) {
        setTeamPagination((current) => ({
          scopeKey: teamPaginationScopeKey,
          visibleCount:
            (current.scopeKey === teamPaginationScopeKey
              ? current.visibleCount
              : groupVisibleCount) + groupVisibleCount,
        }));
        return true;
      }
      const parsed = parseCloudRemoteItemId(item.id);
      if (!parsed) return false;
      const row = findRow(parsed.rowId);
      // Unpublished / vanished rows swallow the click (no-op).
      if (!row || row.eventsEpoch === undefined) {
        return true;
      }
      // The viewer's own member row of a team conversation (multi-owner
      // families surface own rows in this section): open the LOCAL session
      // directly — replaying a copy of one's own transcript is never right.
      if (
        row.ownerUserId === selfUserId &&
        localOwnSessionIds.has(row.sourceSessionId)
      ) {
        openTeamSessionAtDestination(row, disposition);
        return true;
      }
      // A row already downloading refocuses its tab instead of a dead click;
      // other rows are NOT blocked by someone else's in-flight action.
      const busy = busySessionRows.get(row.id);
      if (busy) {
        if (busy.kind === "replay" && busy.localSessionId) {
          openTeamSessionAtDestination(row, disposition);
        }
        return true;
      }
      openTeamSessionAtDestination(row, disposition);
      return true;
    },
    [
      busySessionRows,
      findRow,
      localOwnSessionIds,
      openTeamSessionAtDestination,
      selfUserId,
      groupVisibleCount,
      teamPaginationScopeKey,
      setTeamPagination,
    ]
  );

  return { openTeamSessionAtDestination, handleCloudSessionItemClick };
}
