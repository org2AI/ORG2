import { useAtom, useAtomValue, useStore } from "jotai";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";

import { invalidateProjectCache } from "@src/api/http/project";
import type { MemberEntry } from "@src/api/http/project";
import {
  org2CloudAuthAtom,
  org2CloudAuthIdentityKey,
} from "@src/features/Org2Cloud/org2CloudAuthAtom";
import {
  org2CloudCommentsSignalAtom,
  orgCommentsKey,
} from "@src/features/Org2Cloud/org2CloudCommentsBus";
import {
  getSidebarActiveCloudOrg,
  org2CloudOrgsAtom,
  org2CloudRosterVersionAtom,
  sidebarActiveCloudOrgIdAtom,
} from "@src/features/Org2Cloud/org2CloudOrgsAtom";
import { useProjectDataChanged } from "@src/hooks/project";
import { useCurrentUserMemberIds } from "@src/hooks/project/useCurrentUserMemberId";
import { projectRosterChangedSignalAtom } from "@src/hooks/project/useProjectDataChanged";

import {
  archiveLocalTeamInboxItem,
  listLocalTeamInboxMutedKinds,
  listLocalTeamInboxPage,
  setLocalTeamInboxKindMuted,
  unarchiveLocalTeamInboxItem,
} from "./api";
import { getTeamInboxItemKey } from "./domain";
import type { TeamInboxDataSource } from "./domain";
import { teamInboxViewerIdentityIds } from "./sessionHandoffProjects";
import { teamInboxCacheAtom, teamInboxInvalidationAtom } from "./store";
import {
  type TeamInboxCoordinatorScope,
  resolveTeamInboxMemberNames,
  teamInboxCoordinator,
} from "./teamInboxCoordinator";
import {
  issueError,
  pendingMembersRequest,
  resetMembersRequest,
  teamInboxCloudMemberSnapshotAtom,
  teamInboxMemberSnapshotAtom,
} from "./teamInboxMemberSnapshot";
import { createTeamInboxSessionHandoffMethods } from "./teamInboxSessionHandoff";
import { useTeamInboxMemberRosters } from "./useTeamInboxMemberRosters";

export { __TEAM_INBOX_MEMBER_INTERNALS } from "./teamInboxMemberSnapshot";

const TEAM_INBOX_REFRESH_FLOOR_MS = 15_000;

export function useTeamInboxDataSource(): {
  dataSource: TeamInboxDataSource;
  viewerMemberIds: readonly string[];
} {
  const store = useStore();
  const [memberSnapshot, setMemberSnapshot] = useAtom(
    teamInboxMemberSnapshotAtom
  );
  const [cloudMemberSnapshot, setCloudMemberSnapshot] = useAtom(
    teamInboxCloudMemberSnapshotAtom
  );
  const { members } = memberSnapshot;
  const {
    memberIds: localViewerMemberIds,
    currentUser: localCurrentUser,
    gitEmail,
  } = useCurrentUserMemberIds(members);
  const auth = useAtomValue(org2CloudAuthAtom);
  const authIdentityKey = auth ? org2CloudAuthIdentityKey(auth) : null;
  const activeCloudOrgId = useAtomValue(sidebarActiveCloudOrgIdAtom);
  const cloudOrgs = useAtomValue(org2CloudOrgsAtom);
  const rosterVersions = useAtomValue(org2CloudRosterVersionAtom);
  const activeCloudOrg = useMemo(
    () => getSidebarActiveCloudOrg(activeCloudOrgId, cloudOrgs),
    [activeCloudOrgId, cloudOrgs]
  );
  const activeCloudRosterVersion = activeCloudOrgId
    ? (rosterVersions[activeCloudOrgId] ?? 0)
    : 0;
  const cloudRosterKey =
    authIdentityKey && activeCloudOrgId
      ? `${authIdentityKey}|${activeCloudOrgId}`
      : "";
  const cloudMembers = useMemo(
    () =>
      cloudMemberSnapshot.key === cloudRosterKey
        ? cloudMemberSnapshot.members
        : [],
    [cloudMemberSnapshot, cloudRosterKey]
  );
  const viewerMemberIds = useMemo(
    () =>
      teamInboxViewerIdentityIds(
        localViewerMemberIds,
        [localCurrentUser?.id ?? "", gitEmail],
        activeCloudOrgId && auth ? auth.userId : undefined
      ),
    [
      activeCloudOrgId,
      auth,
      gitEmail,
      localCurrentUser?.id,
      localViewerMemberIds,
    ]
  );
  const scopeMembers = useMemo<MemberEntry[]>(() => {
    const byId = new Map(members.map((member) => [member.id, member]));
    for (const member of cloudMembers) {
      if (member.status !== "active") continue;
      byId.set(member.userId, {
        id: member.userId,
        name: member.displayName?.trim() || member.userId,
        active: true,
      });
    }
    return [...byId.values()];
  }, [cloudMembers, members]);
  const commentsSignals = useAtomValue(org2CloudCommentsSignalAtom);
  // Every consumer observes the same version; the coordinator single-flights
  // the resulting request instead of giving each hook its own request state.
  const invalidation = useAtomValue(teamInboxInvalidationAtom);
  const localRosterVersion = useAtomValue(projectRosterChangedSignalAtom);
  const activeCloudCommentsRevision = activeCloudOrgId
    ? (commentsSignals[orgCommentsKey(activeCloudOrgId)] ?? 0)
    : 0;
  const viewerKey = `${viewerMemberIds.join("|")}::${authIdentityKey ?? "signed-out"}::${activeCloudOrgId ?? "local"}`;
  const scope = useMemo<TeamInboxCoordinatorScope>(
    () => ({
      key: viewerKey,
      viewerMemberIds,
      accessToken: auth?.accessToken ?? null,
      activeCloudOrgId,
      members: scopeMembers,
      prerequisiteIssue: memberSnapshot.issue,
    }),
    [
      activeCloudOrgId,
      auth?.accessToken,
      memberSnapshot.issue,
      scopeMembers,
      viewerKey,
      viewerMemberIds,
    ]
  );

  useLayoutEffect(() => {
    teamInboxCoordinator.ensureScope(store, viewerKey);
  }, [store, viewerKey]);

  useTeamInboxMemberRosters({
    store,
    auth,
    activeCloudOrgId,
    activeCloudRosterVersion,
    authIdentityKey,
    cloudRosterKey,
    localRosterVersion,
    memberSnapshot,
    setMemberSnapshot,
    cloudMemberSnapshot,
    setCloudMemberSnapshot,
  });

  // The refresh is a full dual-source first-page listing and this hook is
  // permanently mounted via the sidebar connector, so invalidation bursts
  // (comment storms, project mutations) get a floor: immediate on a fresh
  // scope or quiet period, otherwise one trailing refresh carrying the
  // latest version — never dropped, never more than one per floor window.
  const refreshFloorRef = useRef<{
    scopeKey: string;
    lastAtMs: number;
    timer: ReturnType<typeof setTimeout> | null;
    pendingVersion: string;
  }>({ scopeKey: "", lastAtMs: 0, timer: null, pendingVersion: "" });
  useEffect(() => {
    const requestVersion = `${invalidation}:${activeCloudCommentsRevision}:${activeCloudRosterVersion}:${scopeMembers.length}:${memberSnapshot.issue?.code ?? "members-ok"}`;
    const floor = refreshFloorRef.current;
    const now = Date.now();
    const elapsed = now - floor.lastAtMs;
    if (
      floor.scopeKey !== scope.key ||
      elapsed >= TEAM_INBOX_REFRESH_FLOOR_MS
    ) {
      if (floor.timer) {
        clearTimeout(floor.timer);
        floor.timer = null;
      }
      floor.scopeKey = scope.key;
      floor.lastAtMs = now;
      void teamInboxCoordinator.refresh(store, scope, requestVersion);
      return;
    }
    floor.pendingVersion = requestVersion;
    if (floor.timer) return;
    floor.timer = setTimeout(() => {
      floor.timer = null;
      floor.lastAtMs = Date.now();
      void teamInboxCoordinator.refresh(store, scope, floor.pendingVersion);
    }, TEAM_INBOX_REFRESH_FLOOR_MS - elapsed);
  }, [
    activeCloudCommentsRevision,
    activeCloudRosterVersion,
    invalidation,
    memberSnapshot.issue?.code,
    scopeMembers.length,
    scope,
    store,
  ]);
  useEffect(
    () => () => {
      const floor = refreshFloorRef.current;
      if (floor.timer) {
        clearTimeout(floor.timer);
        floor.timer = null;
      }
    },
    []
  );

  useProjectDataChanged(() => teamInboxCoordinator.invalidate(store));

  const dataSource = useMemo<TeamInboxDataSource>(() => {
    const getSnapshot = () => {
      const cache = store.get(teamInboxCacheAtom);
      if (cache.loadedForViewerKey !== scope.key) {
        return {
          items: [],
          loading: true,
          issue: null,
          unreadCounts: { all: 0, mentions: 0, assigned: 0 },
          nextCursor: null,
        };
      }
      return {
        items: cache.items,
        loading: cache.loading,
        issue: cache.issue,
        unreadCounts: cache.unreadCounts,
        nextCursor: cache.hasMore
          ? { occurredAt: "", itemKey: "team-inbox-has-more" }
          : null,
      };
    };

    return {
      scopeKey: scope.key,
      getSnapshot,
      listPage: async () => {
        const cache = store.get(teamInboxCacheAtom);
        if (
          cache.issue &&
          cache.items.length === 0 &&
          cache.issue.code !== "partial_load"
        ) {
          throw issueError(cache.issue);
        }
        return getSnapshot();
      },
      listArchivedPage: async ({ cursor, limit = 50, signal }) => {
        if (viewerMemberIds.length === 0) {
          return { items: [], nextCursor: null };
        }
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const result = await listLocalTeamInboxPage(
          viewerMemberIds,
          "archived",
          cursor,
          limit
        );
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        return {
          ...result.page,
          items: resolveTeamInboxMemberNames(result.page.items, scope.members),
        };
      },
      loadMore: () => teamInboxCoordinator.loadMore(store, scope),
      refresh: async () => {
        // Explicit refresh reuses any in-flight roster read, then fences the
        // API cache and lets the owning effect perform one fresh fan-out.
        await pendingMembersRequest()?.catch(() => undefined);
        invalidateProjectCache();
        resetMembersRequest();
        setMemberSnapshot((current) => ({
          ...current,
          loadedForRosterVersion: null,
        }));
        teamInboxCoordinator.invalidate(store);
      },
      markRead: (item) => teamInboxCoordinator.markRead(store, scope, item),
      markUnread: (item) => teamInboxCoordinator.markUnread(store, scope, item),
      markAllRead: (_items, filter = "all") =>
        teamInboxCoordinator.markAllRead(store, scope, filter),
      reconcileItem: (itemKey, nextItem) =>
        teamInboxCoordinator.reconcileItem(store, scope.key, itemKey, nextItem),
      archiveItem: async (item) => {
        const archived = await archiveLocalTeamInboxItem(
          viewerMemberIds,
          item.id
        );
        if (!archived) throw new Error("Team Inbox item is no longer visible");
        teamInboxCoordinator.reconcileItem(
          store,
          scope.key,
          getTeamInboxItemKey(item),
          null
        );
        teamInboxCoordinator.invalidate(store);
      },
      unarchiveItem: async (item) => {
        const unarchived = await unarchiveLocalTeamInboxItem(
          viewerMemberIds,
          item.id
        );
        if (!unarchived)
          throw new Error("Team Inbox item is no longer visible");
        teamInboxCoordinator.reconcileItem(
          store,
          scope.key,
          getTeamInboxItemKey(item),
          item
        );
        teamInboxCoordinator.invalidate(store);
      },
      // Category preferences are keyed by the authoritative local/cloud
      // viewer identity. Do not expose a control that can only resolve to an
      // empty Promise.all and appear to save when this installation has no
      // member identity in the active scope.
      listMutedKinds: viewerMemberIds[0]
        ? () => listLocalTeamInboxMutedKinds(viewerMemberIds)
        : undefined,
      setKindMuted: viewerMemberIds[0]
        ? (kind, muted) =>
            setLocalTeamInboxKindMuted(viewerMemberIds, kind, muted)
        : undefined,
      ...createTeamInboxSessionHandoffMethods({
        store,
        scope,
        auth,
        activeCloudOrg,
        activeCloudRosterVersion,
        viewerMemberIds,
      }),
      subscribe: (listener) => {
        let revision = store.get(teamInboxCacheAtom).revision;
        return store.sub(teamInboxCacheAtom, () => {
          const nextRevision = store.get(teamInboxCacheAtom).revision;
          if (nextRevision === revision) return;
          revision = nextRevision;
          listener();
        });
      },
    };
  }, [
    activeCloudOrg,
    activeCloudRosterVersion,
    auth,
    scope,
    setMemberSnapshot,
    store,
    viewerMemberIds,
  ]);

  return { dataSource, viewerMemberIds };
}
