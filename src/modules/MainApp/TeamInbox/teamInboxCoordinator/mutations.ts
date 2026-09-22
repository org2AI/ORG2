import type { Store } from "jotai/vanilla/store";

import type { TeamInboxReadMutation } from "@src/features/Org2Cloud/teamInboxMentionsClient";

import { getTeamInboxItemKey } from "../domain";
import type { TeamInboxFilter, TeamInboxItem } from "../domain";
import { teamInboxCacheAtom } from "../store";
import { patchTeamInboxReadState } from "./cachePatches";
import { errorDetail } from "./items";
import {
  type CoordinatorRuntime,
  MAX_PENDING_TEAM_INBOX_MUTATIONS,
  type Settled,
  type TeamInboxCoordinatorContext,
  type TeamInboxCoordinatorScope,
  settle,
} from "./runtime";

export function enqueueMutation<T>(
  runtime: CoordinatorRuntime,
  operation: () => Promise<T>
): Promise<T> {
  if (runtime.pendingMutations >= MAX_PENDING_TEAM_INBOX_MUTATIONS) {
    return Promise.reject(new Error("Too many pending Team Inbox updates"));
  }
  runtime.pendingMutations += 1;
  const run = async (): Promise<T> => {
    try {
      return await operation();
    } finally {
      runtime.pendingMutations = Math.max(0, runtime.pendingMutations - 1);
    }
  };
  const result = runtime.mutationTail.then(run, run);
  runtime.mutationTail = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

export function setTeamInboxReadState(
  { dependencies, runtimeByStore }: TeamInboxCoordinatorContext,
  store: Store,
  runtime: CoordinatorRuntime,
  scope: TeamInboxCoordinatorScope,
  item: TeamInboxItem,
  read: boolean
): Promise<void> {
  const itemKey = getTeamInboxItemKey(item);
  // Idempotency lives here, not just at the call site, so any caller —
  // including future ones — can't double-fire a read/unread mutation and
  // send a redundant network round-trip that risks drifting unreadCount.
  // Check the live cache rather than the passed-in `item`, which may be a
  // stale snapshot from the caller's render.
  const currentItem = store
    .get(teamInboxCacheAtom)
    .items.find((candidate) => getTeamInboxItemKey(candidate) === itemKey);
  const currentlyRead = (currentItem ?? item).readAt !== null;
  if (currentlyRead === read) {
    return Promise.resolve();
  }
  const epoch = ++runtime.mutationEpoch;
  runtime.mutationEpochByItem.set(itemKey, epoch);
  patchTeamInboxReadState(
    runtimeByStore,
    store,
    scope.key,
    itemKey,
    read ? dependencies.now() : null
  );

  return enqueueMutation(runtime, async () => {
    try {
      let cloudResult: TeamInboxReadMutation | null = null;
      if (item.kind === "comment_mention") {
        if (!scope.accessToken || !scope.activeCloudOrgId) {
          throw new Error("Cloud identity is unavailable");
        }
        cloudResult = await dependencies.setMentionRead(
          scope.accessToken,
          scope.activeCloudOrgId,
          item.target.commentId,
          read,
          runtime.scopeController.signal
        );
      } else {
        const updated = read
          ? await dependencies.markLocalRead(scope.viewerMemberIds, item.id)
          : await dependencies.markLocalUnread(scope.viewerMemberIds, item.id);
        if (!updated)
          throw new Error("Assigned Work Item is no longer visible");
      }
      if (
        runtimeByStore.get(store) !== runtime ||
        runtime.scopeController.signal.aborted ||
        runtime.mutationEpochByItem.get(itemKey) !== epoch
      ) {
        return;
      }
      if (cloudResult) {
        const authoritativeReadAt = read
          ? (cloudResult.readAt ?? dependencies.now())
          : null;
        patchTeamInboxReadState(
          runtimeByStore,
          store,
          scope.key,
          itemKey,
          authoritativeReadAt,
          cloudResult.unreadCount
        );
      }
    } catch (error) {
      if (
        runtimeByStore.get(store) === runtime &&
        !runtime.scopeController.signal.aborted &&
        runtime.mutationEpochByItem.get(itemKey) === epoch
      ) {
        patchTeamInboxReadState(
          runtimeByStore,
          store,
          scope.key,
          itemKey,
          read ? null : item.readAt
        );
      }
      throw error;
    } finally {
      if (runtime.mutationEpochByItem.get(itemKey) === epoch) {
        runtime.mutationEpochByItem.delete(itemKey);
      }
    }
  });
}

export function markAllTeamInboxRead(
  { dependencies, runtimeByStore }: TeamInboxCoordinatorContext,
  store: Store,
  runtime: CoordinatorRuntime,
  scope: TeamInboxCoordinatorScope,
  filter: TeamInboxFilter
): Promise<void> {
  return enqueueMutation(runtime, async () => {
    if (filter === "archived") return;
    const includeCloudMentions = filter === "all" || filter === "mentions";
    const localUnreadForFilter =
      filter === "all"
        ? runtime.localUnreadCounts.all
        : filter === "mentions"
          ? runtime.localUnreadCounts.mentions
          : runtime.localUnreadCounts.assigned;
    const [local, cloud] = await Promise.all([
      localUnreadForFilter > 0
        ? settle(dependencies.markAllLocalRead(scope.viewerMemberIds, filter))
        : Promise.resolve<Settled<number>>({ ok: true, value: 0 }),
      includeCloudMentions && runtime.cloudUnreadCount > 0
        ? scope.accessToken && scope.activeCloudOrgId
          ? settle(
              dependencies.markAllMentionsRead(
                scope.accessToken,
                scope.activeCloudOrgId,
                runtime.scopeController.signal
              )
            )
          : Promise.resolve<Settled<TeamInboxReadMutation>>({
              ok: false,
              error: new Error("Cloud identity is unavailable"),
            })
        : Promise.resolve<Settled<TeamInboxReadMutation>>({
            ok: true,
            value: { readAt: null, unreadCount: 0 },
          }),
    ]);
    if (
      runtimeByStore.get(store) !== runtime ||
      runtime.scopeController.signal.aborted
    ) {
      return;
    }
    const readAt = cloud.ok
      ? (cloud.value.readAt ?? dependencies.now())
      : dependencies.now();
    if (local.ok) {
      if (filter === "all") {
        runtime.localUnreadCounts = { all: 0, mentions: 0, assigned: 0 };
      } else if (filter === "mentions") {
        runtime.localUnreadCounts = {
          ...runtime.localUnreadCounts,
          all: Math.max(
            0,
            runtime.localUnreadCounts.all - runtime.localUnreadCounts.mentions
          ),
          mentions: 0,
        };
      } else {
        runtime.localUnreadCounts = {
          ...runtime.localUnreadCounts,
          all: Math.max(
            0,
            runtime.localUnreadCounts.all - runtime.localUnreadCounts.assigned
          ),
          assigned: 0,
        };
      }
    }
    if (includeCloudMentions && cloud.ok) {
      runtime.cloudUnreadCount = cloud.value.unreadCount;
    }
    store.set(teamInboxCacheAtom, (current) => {
      const assigned = runtime.localUnreadCounts.assigned;
      const mentions =
        runtime.localUnreadCounts.mentions + runtime.cloudUnreadCount;
      const all = runtime.localUnreadCounts.all + runtime.cloudUnreadCount;
      return {
        ...current,
        items: current.items.map((candidate) => {
          const shouldMark =
            (local.ok &&
              candidate.source !== "cloud" &&
              (filter === "all" ||
                (filter === "assigned" &&
                  candidate.kind === "assigned_work_item") ||
                (filter === "mentions" &&
                  candidate.kind === "comment_mention"))) ||
            (includeCloudMentions &&
              cloud.ok &&
              candidate.source === "cloud" &&
              candidate.kind === "comment_mention");
          return shouldMark ? { ...candidate, readAt } : candidate;
        }),
        unreadCount: all,
        unreadCounts: { all, assigned, mentions },
        revision: current.revision + 1,
      };
    });
    const failures = [
      ...(local.ok ? [] : [local.error]),
      ...(cloud.ok ? [] : [cloud.error]),
    ];
    if (failures.length > 0) {
      throw new Error(errorDetail(failures) ?? "Team Inbox update failed");
    }
  });
}
