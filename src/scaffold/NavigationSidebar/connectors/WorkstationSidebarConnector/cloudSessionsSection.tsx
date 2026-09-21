/**
 * Cloud-org "Team sessions" sidebar section (managed ORG2 Cloud scope).
 *
 * Replaces the Cloud Org panel's shared-sessions list: when the sidebar's
 * active scope is a cloud org, teammates' shared sessions render as
 * collapsible fork-threaded groups under a separator-headed section.
 * Threads come from the pure `buildCloudSessionThreads` helper; replay/fork
 * ride the same canonical `useCloudSessionActions` used by Kanban List.
 *
 * Team Conversations is remote-only: exact local-device rows are filtered
 * before grouping and stay under My Sessions. Same-account rows without a
 * matching local session id are retained because they came from another
 * device. Every rendered row gets a `cloudremote-<orgId>|<rowId>` id.
 *
 * Parent-row choice: a thread root sets `navigableParent`, so a body/label
 * click OPENS the source session (replay/open) while the dedicated chevron
 * toggles the fork thread — without the flag the primitive treats a
 * children-bearing row as a group header whose whole body only toggles,
 * which stranded fork sources as unclickable once a fork added a child row.
 * The primitive renders hover rowActions on LEAF rows only, so Replay/Fork
 * hover buttons appear on descendants and on single-row threads (rendered
 * as leaves); a multi-row thread's root keeps click-to-replay but has no
 * hover fork button — no self-duplicate child row is injected.
 *
 *
 * This hook is a coordinator: thread derivation, selection, open/click
 * handlers, reveal handlers, hide/pin state, row construction, menu-item
 * assembly, roster loading, local-hydration bookkeeping, and the
 * member-filter dropdown each live in a sibling `cloudSessionsSection.*`
 * module (see those files' own header comments).
 */
import { useAtom, useAtomValue, useStore } from "jotai";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { useRefreshSpin } from "@src/components/RefreshIcon/useRefreshSpin";
import { dismissCloudReferenceOpeningToast } from "@src/features/Org2Cloud/cloudReferenceOpeningToast";
import { cloudDownloadStartRequestAtom } from "@src/features/Org2Cloud/cloudSessionDownloadControlAtoms";
import { org2CloudAuthAtom } from "@src/features/Org2Cloud/org2CloudAuthAtom";
import { org2CloudPresenceAtom } from "@src/features/Org2Cloud/org2CloudPresenceAtom";
import { useCloudOrgRemoteSessions } from "@src/features/Org2Cloud/org2CloudRemoteSessionsAtom";
import {
  org2CloudPushCursorsAtom,
  org2CloudPushedMetadataAtom,
} from "@src/features/Org2Cloud/org2CloudSyncAtoms";
import {
  type CloudSessionReplayOptions,
  useCloudSessionActions,
} from "@src/features/Org2Cloud/useCloudSessionActions";
import type { RemoteTeammateSessionMetadata } from "@src/store/collaboration/types";

import { useCloudMemberFilterDropdown } from "./cloudSessionsSection.MemberFilterDropdown";
import { useCloudHiddenRemoteSessions } from "./cloudSessionsSection.hiddenRows";
import { useCloudLocalSessionHydration } from "./cloudSessionsSection.localHydration";
import { useCloudTeamSessionMenuItems } from "./cloudSessionsSection.menuItems";
import { useCloudSessionOpenHandlers } from "./cloudSessionsSection.openHandlers";
import { useCloudRemoteSessionMenuItems } from "./cloudSessionsSection.remoteMenuItems";
import { useCloudRemoteRowMaps } from "./cloudSessionsSection.remoteRowMaps";
import { useCloudSessionRevealHandlers } from "./cloudSessionsSection.revealHandlers";
import { useCloudOrgRosterMembers } from "./cloudSessionsSection.rosterMembers";
import { useCloudSessionRowItemBuilder } from "./cloudSessionsSection.rowItemBuilder";
import { useCloudSelectedMenuItemId } from "./cloudSessionsSection.selectedItem";
import { useCloudSessionThreadModel } from "./cloudSessionsSection.threadModel";
import type {
  MemberFilterMenuState,
  UseCloudSessionsSectionParams,
  UseCloudSessionsSectionResult,
} from "./cloudSessionsSection.types";

export function useCloudSessionsSection({
  orgId,
  sessions,
  filter,
  activeSessionId,
  localSessionHydrationLimit,
  groupVisibleCount,
  revealedMenuItemId,
  openSessionAtDestination,
  onFilterChange,
}: UseCloudSessionsSectionParams): UseCloudSessionsSectionResult {
  const { t } = useTranslation("navigation");
  const { t: tCommon } = useTranslation("common");
  const { t: tSessions } = useTranslation("sessions");
  const store = useStore();
  const { rows, state, fetchedAt, documentVisible, refresh } =
    useCloudOrgRemoteSessions(orgId);
  const { spinClass: refreshSpinClass, handleClick: handleRefreshClick } =
    useRefreshSpin(
      refresh,
      false,
      orgId ? `cloud-team-sessions:${orgId}` : undefined
    );
  const { replaySession, forkSession, busySessionRows } =
    useCloudSessionActions(orgId);
  const presenceMap = useAtomValue(org2CloudPresenceAtom);
  const pushedMetadata = useAtomValue(org2CloudPushedMetadataAtom);
  const pushCursors = useAtomValue(org2CloudPushCursorsAtom);
  const [auth, setAuth] = useAtom(org2CloudAuthAtom);
  const selfUserId = auth?.userId ?? null;
  const rosterMembers = useCloudOrgRosterMembers({
    orgId,
    auth,
    setAuth,
    store,
  });
  const [memberMenu, setMemberMenu] = useState<MemberFilterMenuState | null>(
    null
  );
  const {
    hiddenRemoteSessionIds,
    setHiddenRemoteSessionIds,
    resubscribeRemoteRow,
    hideRemoteSession,
  } = useCloudHiddenRemoteSessions({ sessions });

  const { localOwnSessionIds, cloudLocalSessionIds } =
    useCloudLocalSessionHydration({
      orgId,
      sessions,
      pushedMetadata,
      pushCursors,
      selfUserId,
      rows,
      documentVisible,
      localSessionHydrationLimit,
    });

  const {
    threads,
    visibleThreads,
    teamPaginationScopeKey,
    setTeamPagination,
    resetCloudTeamPagination,
    cloudFlatListExcludedSessionIds,
  } = useCloudSessionThreadModel({
    orgId,
    rows,
    sessions,
    filter,
    revealedMenuItemId,
    groupVisibleCount,
    hiddenRemoteSessionIds,
    localOwnSessionIds,
    selfUserId,
  });

  const selectedCloudMenuItemId = useCloudSelectedMenuItemId({
    orgId,
    activeSessionId,
    sessions,
    visibleThreads,
  });

  const findRow = useCallback(
    (rowId: string): RemoteTeammateSessionMetadata | undefined =>
      rows.find((row) => row.id === rowId),
    [rows]
  );

  const runReplay = useCallback(
    (
      row: RemoteTeammateSessionMetadata,
      options?: CloudSessionReplayOptions
    ) => {
      // The replay is starting: the pre-phase toast has served its purpose
      // (a no-op for sidebar-origin clicks that never showed one).
      dismissCloudReferenceOpeningToast();
      resubscribeRemoteRow(row);
      void replaySession(row, options);
    },
    [replaySession, resubscribeRemoteRow]
  );

  // The pane's play/resume cards cannot reach the replay hook; they park a
  // start request here. First mounted consumer wins (the store re-read makes
  // the second connector's effect a no-op), and the busy registry dedups any
  // race that slips through.
  const downloadStartRequest = useAtomValue(cloudDownloadStartRequestAtom);
  useEffect(() => {
    if (!downloadStartRequest || downloadStartRequest.orgId !== orgId) return;
    if (store.get(cloudDownloadStartRequestAtom) !== downloadStartRequest) {
      return;
    }
    const row = findRow(downloadStartRequest.rowId);
    if (!row) return;
    const startKind = downloadStartRequest.kind;
    store.set(cloudDownloadStartRequestAtom, null);
    // queueMicrotask to satisfy react-hooks/set-state-in-effect: the
    // resubscribe inside runReplay touches React state, and the request
    // slot was already consumed synchronously above.
    queueMicrotask(() => {
      if (startKind === "fork") {
        void forkSession(row, { skipDownloadGate: true });
      } else {
        runReplay(row, { skipDownloadGate: true });
      }
    });
  }, [downloadStartRequest, findRow, forkSession, orgId, runReplay, store]);

  const runFork = useCallback(
    (row: RemoteTeammateSessionMetadata) => {
      void forkSession(row);
    },
    [forkSession]
  );

  const { openTeamSessionAtDestination, handleCloudSessionItemClick } =
    useCloudSessionOpenHandlers({
      selfUserId,
      localOwnSessionIds,
      busySessionRows,
      openSessionAtDestination,
      runReplay,
      findRow,
      teamPaginationScopeKey,
      groupVisibleCount,
      setTeamPagination,
    });

  useCloudSessionRevealHandlers({
    t,
    orgId,
    rows,
    state,
    fetchedAt,
    busySessionRows,
    selfUserId,
    localOwnSessionIds,
    handleRefreshClick,
    runReplay,
  });

  const {
    pinnedRemoteSessionIds,
    toggleRemoteSessionPin,
    buildRemoteSessionMenuItems,
    buildCloudRemoteItemMenuItems,
  } = useCloudRemoteSessionMenuItems({
    t,
    tCommon,
    tSessions,
    openTeamSessionAtDestination,
    hideRemoteSession,
    findRow,
  });

  const buildRowItem = useCloudSessionRowItemBuilder({
    presenceMap,
    selfUserId,
    t,
    tCommon,
    runFork,
    buildNativeMenuItems: buildRemoteSessionMenuItems,
    busySessionRows,
    pinnedRemoteSessionIds,
    toggleRemoteSessionPin,
  });

  const cloudMenuItems = useCloudTeamSessionMenuItems({
    orgId,
    threads,
    visibleThreads,
    state,
    filter,
    memberMenu,
    setMemberMenu,
    refreshSpinClass,
    handleRefreshClick,
    buildRowItem,
    t,
    tCommon,
  });

  const { cloudRemoteRowMap, cloudRemoteViewerMap } = useCloudRemoteRowMaps({
    visibleThreads,
    presenceMap,
    selfUserId,
  });

  const cloudMemberFilterDropdown = useCloudMemberFilterDropdown({
    orgId,
    filter,
    memberMenu,
    setMemberMenu,
    rows,
    rosterMembers,
    hiddenRemoteSessionIds,
    setHiddenRemoteSessionIds,
    presenceMap,
    onFilterChange,
    t,
  });

  return {
    cloudMenuItems,
    cloudFlatListExcludedSessionIds,
    cloudLocalSessionIds,
    selectedCloudMenuItemId,
    handleCloudSessionItemClick,
    resetCloudTeamPagination,
    buildCloudRemoteItemMenuItems,
    cloudMemberFilterDropdown,
    cloudRemoteRowMap,
    cloudRemoteViewerMap,
  };
}
