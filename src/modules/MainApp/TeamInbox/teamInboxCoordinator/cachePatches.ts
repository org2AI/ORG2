import type { Store } from "jotai/vanilla/store";

import { getTeamInboxItemKey } from "../domain";
import type { TeamInboxItem } from "../domain";
import { teamInboxCacheAtom } from "../store";
import { boundedItems } from "./items";
import type { CoordinatorRuntimeByStore } from "./runtime";

export function reconcileTeamInboxItem(
  runtimeByStore: CoordinatorRuntimeByStore,
  store: Store,
  scopeKey: string,
  itemKey: string,
  nextItem: TeamInboxItem | null
): void {
  const previousSnapshot = store.get(teamInboxCacheAtom);
  const previousSnapshotItem = previousSnapshot.items.find(
    (candidate) => getTeamInboxItemKey(candidate) === itemKey
  );
  const unreadDelta =
    Number(nextItem?.readAt === null) -
    Number(previousSnapshotItem?.readAt === null);
  const runtime = runtimeByStore.get(store);
  if (runtime?.scopeKey === scopeKey && unreadDelta !== 0) {
    const affectedItem = previousSnapshotItem ?? nextItem;
    if (affectedItem?.source === "cloud") {
      runtime.cloudUnreadCount = Math.max(
        0,
        runtime.cloudUnreadCount + unreadDelta
      );
    } else if (affectedItem) {
      runtime.localUnreadCounts = {
        all: Math.max(0, runtime.localUnreadCounts.all + unreadDelta),
        mentions:
          affectedItem.kind === "comment_mention"
            ? Math.max(0, runtime.localUnreadCounts.mentions + unreadDelta)
            : runtime.localUnreadCounts.mentions,
        assigned:
          affectedItem.kind === "assigned_work_item"
            ? Math.max(0, runtime.localUnreadCounts.assigned + unreadDelta)
            : runtime.localUnreadCounts.assigned,
      };
    }
  }
  store.set(teamInboxCacheAtom, (current) => {
    if (current.loadedForViewerKey !== scopeKey) return current;
    const previousItem = current.items.find(
      (candidate) => getTeamInboxItemKey(candidate) === itemKey
    );
    const nextItems = previousItem
      ? current.items.flatMap((candidate) =>
          getTeamInboxItemKey(candidate) === itemKey
            ? nextItem
              ? [nextItem]
              : []
            : [candidate]
        )
      : nextItem
        ? [...current.items, nextItem]
        : current.items;
    const previousUnread = previousItem?.readAt === null ? 1 : 0;
    const nextUnread = nextItem?.readAt === null ? 1 : 0;
    const unreadDelta = nextUnread - previousUnread;
    const runtimeMatches = runtime?.scopeKey === scopeKey;
    const assigned = runtimeMatches
      ? runtime.localUnreadCounts.assigned
      : previousItem?.kind === "assigned_work_item" ||
          nextItem?.kind === "assigned_work_item"
        ? Math.max(0, current.unreadCounts.assigned + unreadDelta)
        : current.unreadCounts.assigned;
    const mentions = runtimeMatches
      ? runtime.localUnreadCounts.mentions + runtime.cloudUnreadCount
      : previousItem?.kind === "comment_mention" ||
          nextItem?.kind === "comment_mention"
        ? Math.max(0, current.unreadCounts.mentions + unreadDelta)
        : current.unreadCounts.mentions;
    const all = runtimeMatches
      ? runtime.localUnreadCounts.all + runtime.cloudUnreadCount
      : Math.max(0, current.unreadCounts.all + unreadDelta);
    return {
      ...current,
      items: boundedItems(nextItems),
      unreadCount: all,
      unreadCounts: { all, assigned, mentions },
      revision: current.revision + 1,
    };
  });
}

export function patchTeamInboxReadState(
  runtimeByStore: CoordinatorRuntimeByStore,
  store: Store,
  scopeKey: string,
  itemKey: string,
  readAt: string | null,
  authoritativeMentionUnread?: number
): void {
  const cachedCandidate = store
    .get(teamInboxCacheAtom)
    .items.find((item) => getTeamInboxItemKey(item) === itemKey);
  const runtime = runtimeByStore.get(store);
  if (cachedCandidate && runtime?.scopeKey === scopeKey) {
    const delta =
      Number(readAt === null) - Number(cachedCandidate.readAt === null);
    if (cachedCandidate.source === "cloud") {
      runtime.cloudUnreadCount =
        authoritativeMentionUnread ??
        Math.max(0, runtime.cloudUnreadCount + delta);
    } else {
      runtime.localUnreadCounts = {
        all: Math.max(0, runtime.localUnreadCounts.all + delta),
        mentions:
          cachedCandidate.kind === "comment_mention"
            ? Math.max(0, runtime.localUnreadCounts.mentions + delta)
            : runtime.localUnreadCounts.mentions,
        assigned:
          cachedCandidate.kind === "assigned_work_item"
            ? Math.max(0, runtime.localUnreadCounts.assigned + delta)
            : runtime.localUnreadCounts.assigned,
      };
    }
  }
  store.set(teamInboxCacheAtom, (current) => {
    if (current.loadedForViewerKey !== scopeKey) return current;
    const candidate = current.items.find(
      (item) => getTeamInboxItemKey(item) === itemKey
    );
    if (!candidate) return current;
    const wasUnread = candidate.readAt === null;
    const willBeUnread = readAt === null;
    const delta = Number(willBeUnread) - Number(wasUnread);
    const currentRuntime = runtimeByStore.get(store);
    const runtimeMatches = currentRuntime?.scopeKey === scopeKey;
    const assigned = runtimeMatches
      ? currentRuntime.localUnreadCounts.assigned
      : candidate.kind === "assigned_work_item"
        ? Math.max(0, current.unreadCounts.assigned + delta)
        : current.unreadCounts.assigned;
    const mentions = runtimeMatches
      ? currentRuntime.localUnreadCounts.mentions +
        currentRuntime.cloudUnreadCount
      : candidate.kind === "comment_mention"
        ? (authoritativeMentionUnread ??
          Math.max(0, current.unreadCounts.mentions + delta))
        : current.unreadCounts.mentions;
    const all = runtimeMatches
      ? currentRuntime.localUnreadCounts.all + currentRuntime.cloudUnreadCount
      : Math.max(0, current.unreadCounts.all + delta);
    return {
      ...current,
      items: current.items.map((item) =>
        getTeamInboxItemKey(item) === itemKey ? { ...item, readAt } : item
      ),
      unreadCount: all,
      unreadCounts: { all, assigned, mentions },
      revision: current.revision + 1,
    };
  });
}
