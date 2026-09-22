/**
 * Thread derivation for `useCloudSessionsSection`: hidden-row filtering, the
 * presentation filter (plus the one cross-surface revealed row), fork-thread
 * grouping, Team-section pagination, and the local session ids the flat
 * "My Sessions" list must hide.
 */
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useMemo, useState } from "react";

import { hiddenRemoteSessionKey } from "@src/features/Org2Cloud/cloudHiddenRemoteSessions";
import {
  buildCloudRemoteItemId,
  includeRevealedCloudRow,
} from "@src/features/Org2Cloud/cloudRemoteItemId";
import {
  type CloudSessionFilter,
  filterCloudSessionRows,
} from "@src/features/Org2Cloud/cloudSessionFilter";
import {
  type CloudSessionThread,
  buildCloudSessionThreads,
  collectCloudFlatListExcludedSessionIds,
  collectTeamConversationSessionIds,
} from "@src/features/Org2Cloud/cloudSessionThreads";
import type { RemoteTeammateSessionMetadata } from "@src/store/collaboration/types";
import type { Session } from "@src/store/session";

import type { SessionGroupVisibleCount } from "../types";
import { resetScopedSectionPagination } from "./sectionPagination";

export interface CloudTeamPaginationState {
  scopeKey: string;
  visibleCount: number;
}

export interface CloudSessionThreadModel {
  threads: CloudSessionThread[];
  visibleThreads: CloudSessionThread[];
  teamPaginationScopeKey: string;
  setTeamPagination: Dispatch<SetStateAction<CloudTeamPaginationState>>;
  resetCloudTeamPagination: () => void;
  cloudFlatListExcludedSessionIds: Set<string>;
}

export function useCloudSessionThreadModel({
  orgId,
  rows,
  sessions,
  filter,
  revealedMenuItemId,
  groupVisibleCount,
  hiddenRemoteSessionIds,
  localOwnSessionIds,
  selfUserId,
}: {
  orgId: string | null;
  rows: readonly RemoteTeammateSessionMetadata[];
  sessions: readonly Session[];
  filter: CloudSessionFilter;
  revealedMenuItemId?: string;
  groupVisibleCount: SessionGroupVisibleCount;
  hiddenRemoteSessionIds: ReadonlySet<string>;
  localOwnSessionIds: ReadonlySet<string>;
  selfUserId: string | null;
}): CloudSessionThreadModel {
  const unhiddenRows = useMemo(
    () =>
      rows.filter(
        (row) =>
          !hiddenRemoteSessionIds.has(hiddenRemoteSessionKey(row.orgId, row.id))
      ),
    [hiddenRemoteSessionIds, rows]
  );

  const visibleRows = useMemo(() => {
    const filtered = filterCloudSessionRows(unhiddenRows, filter);
    // Cross-surface navigation bypasses presentation filters for one row but
    // never mutates the user's persistent Team Sessions filter.
    return includeRevealedCloudRow(
      filtered,
      unhiddenRows,
      orgId,
      revealedMenuItemId
    );
  }, [filter, orgId, revealedMenuItemId, unhiddenRows]);

  const threads = useMemo(
    () =>
      orgId
        ? buildCloudSessionThreads(visibleRows, {
            // Filtering happens before grouping so duplicate suppression and
            // thread roots derive from the exact visible row set.
            memberFilter: null,
            localOwnSessionIds,
            viewerUserId: selfUserId,
          })
        : [],
    [orgId, visibleRows, localOwnSessionIds, selfUserId]
  );
  const teamPaginationScopeKey = useMemo(() => {
    if (!orgId) return "";
    const memberKey = filter.kind === "member" ? filter.ownerUserId : "";
    return `${orgId}\u001f${filter.kind}\u001f${memberKey}`;
  }, [filter, orgId]);
  const [teamPagination, setTeamPagination] = useState<{
    scopeKey: string;
    visibleCount: number;
  }>({
    scopeKey: "",
    visibleCount: groupVisibleCount,
  });
  const requestedTeamVisibleCount =
    teamPagination.scopeKey === teamPaginationScopeKey
      ? teamPagination.visibleCount
      : groupVisibleCount;
  const revealedThreadIndex = useMemo(() => {
    if (!revealedMenuItemId) return -1;
    return threads.findIndex((thread) =>
      [thread.root, ...thread.descendants].some((threadRow) => {
        const itemId = buildCloudRemoteItemId(
          threadRow.row.orgId,
          threadRow.row.id
        );
        return itemId === revealedMenuItemId;
      })
    );
  }, [revealedMenuItemId, threads]);
  const teamVisibleCount = Math.max(
    requestedTeamVisibleCount,
    revealedThreadIndex + 1
  );
  const visibleThreads = useMemo(
    () => threads.slice(0, teamVisibleCount),
    [teamVisibleCount, threads]
  );
  const resetCloudTeamPagination = useCallback(() => {
    setTeamPagination((current) =>
      resetScopedSectionPagination(current, groupVisibleCount)
    );
  }, [groupVisibleCount]);

  // Imported teammate replays materialize a local read-only cache row: hide
  // those caches from My Sessions. Own sessions that belong to a MULTI-owner
  // conversation family hide too — the family's Team Sessions thread is the
  // conversation's single sidebar entry (badge and thread included).
  const cloudFlatListExcludedSessionIds = useMemo(() => {
    if (!orgId) return new Set<string>();
    const excluded = collectCloudFlatListExcludedSessionIds(sessions, orgId);
    for (const sessionId of collectTeamConversationSessionIds(
      rows,
      selfUserId
    )) {
      excluded.add(sessionId);
    }
    return excluded;
  }, [orgId, sessions, rows, selfUserId]);

  return {
    threads,
    visibleThreads,
    teamPaginationScopeKey,
    setTeamPagination,
    resetCloudTeamPagination,
    cloudFlatListExcludedSessionIds,
  };
}
