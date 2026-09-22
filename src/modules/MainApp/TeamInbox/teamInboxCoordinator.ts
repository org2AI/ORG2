import type { Store } from "jotai/vanilla/store";
import isEqual from "lodash/isEqual";

import type { TeamInboxMentionsPage } from "@src/features/Org2Cloud/teamInboxMentionsClient";
import {
  listInitialTeamInboxMentions,
  listTeamInboxMentions,
  markAllTeamInboxMentionsRead,
  setTeamInboxMentionRead,
} from "@src/features/Org2Cloud/teamInboxMentionsClient";

import {
  listLocalTeamInboxPage,
  markAllLocalTeamInboxRead,
  markLocalTeamInboxItemRead,
  markLocalTeamInboxItemUnread,
} from "./api";
import type { TeamInboxFilter, TeamInboxItem } from "./domain";
import { teamInboxCacheAtom, teamInboxInvalidationAtom } from "./store";
import { reconcileTeamInboxItem } from "./teamInboxCoordinator/cachePatches";
import {
  boundedItems,
  issueForFailures,
  mapMentionsToItems,
  mergeIssues,
  prerequisiteIssueForScope,
  resolveTeamInboxMemberNames,
  sameIssue,
} from "./teamInboxCoordinator/items";
import { loadMoreTeamInbox } from "./teamInboxCoordinator/loadMore";
import {
  markAllTeamInboxRead,
  setTeamInboxReadState,
} from "./teamInboxCoordinator/mutations";
import {
  type CoordinatorRuntime,
  type LocalPageResult,
  MAX_CACHED_TEAM_INBOX_ITEMS,
  type Settled,
  type TeamInboxCoordinatorContext,
  type TeamInboxCoordinatorDependencies,
  type TeamInboxCoordinatorScope,
  createRuntime,
  localUnreadCounts,
  settle,
} from "./teamInboxCoordinator/runtime";

export type {
  TeamInboxCoordinatorDependencies,
  TeamInboxCoordinatorScope,
} from "./teamInboxCoordinator/runtime";
export { resolveTeamInboxMemberNames } from "./teamInboxCoordinator/items";

/**
 * Store-scoped Team Inbox coordinator.
 *
 * All mounted consumers in one Jotai store share request identity, cursors,
 * mutation ordering and cancellation. Separate stores receive isolated runtime
 * state through the WeakMap, while persisted/cache state remains in Jotai.
 */
export class TeamInboxCoordinator {
  private readonly runtimeByStore = new WeakMap<Store, CoordinatorRuntime>();
  private readonly context: TeamInboxCoordinatorContext;

  constructor(private readonly dependencies: TeamInboxCoordinatorDependencies) {
    this.context = { dependencies, runtimeByStore: this.runtimeByStore };
  }

  ensureScope(store: Store, scopeKey: string): CoordinatorRuntime {
    const currentRuntime = this.runtimeByStore.get(store);
    if (currentRuntime?.scopeKey === scopeKey) return currentRuntime;

    currentRuntime?.scopeController.abort();
    const runtime = createRuntime(scopeKey);
    this.runtimeByStore.set(store, runtime);

    const cache = store.get(teamInboxCacheAtom);
    if (cache.loadedForViewerKey !== scopeKey) {
      store.set(teamInboxCacheAtom, {
        ...cache,
        items: [],
        unreadCount: 0,
        unreadCounts: { all: 0, mentions: 0, assigned: 0 },
        loading: true,
        hasMore: false,
        loadedForViewerKey: null,
        issue: null,
        revision: cache.revision + 1,
      });
    }
    return runtime;
  }

  invalidate(store: Store): void {
    const runtime = this.runtimeByStore.get(store);
    if (runtime?.invalidationQueued) return;
    if (runtime) runtime.invalidationQueued = true;
    queueMicrotask(() => {
      const latest = this.runtimeByStore.get(store);
      if (latest) latest.invalidationQueued = false;
      store.set(
        teamInboxInvalidationAtom,
        store.get(teamInboxInvalidationAtom) + 1
      );
    });
  }

  refresh(
    store: Store,
    scope: TeamInboxCoordinatorScope,
    requestVersion: string
  ): Promise<void> {
    const runtime = this.ensureScope(store, scope.key);
    runtime.desiredRefreshVersion = requestVersion;

    if (runtime.refreshPromise) {
      if (runtime.activeRefreshVersion !== requestVersion) {
        runtime.queuedRefresh = { scope, version: requestVersion };
      }
      return runtime.refreshPromise;
    }
    if (
      runtime.activeRefreshVersion === requestVersion &&
      store.get(teamInboxCacheAtom).loadedForViewerKey === scope.key
    ) {
      return Promise.resolve();
    }

    const generation = ++runtime.generation;
    runtime.activeRefreshVersion = requestVersion;
    store.set(teamInboxCacheAtom, (current) =>
      current.loadedForViewerKey === scope.key
        ? current
        : { ...current, loading: true, issue: null }
    );

    const canLoadLocal = scope.viewerMemberIds.length > 0;
    const canLoadCloud = Boolean(scope.accessToken && scope.activeCloudOrgId);
    if (!canLoadLocal && !canLoadCloud) {
      runtime.localCursor = null;
      runtime.cloudCursor = null;
      store.set(teamInboxCacheAtom, (current) => ({
        ...current,
        items: [],
        unreadCount: 0,
        unreadCounts: { all: 0, mentions: 0, assigned: 0 },
        loading: false,
        hasMore: false,
        loadedForViewerKey: scope.key,
        issue: prerequisiteIssueForScope(scope),
        revision: current.revision + 1,
      }));
      return Promise.resolve();
    }

    const requestedSourceCount = Number(canLoadLocal) + Number(canLoadCloud);
    const promise = Promise.all([
      canLoadLocal
        ? settle(
            this.dependencies.listLocalPage(scope.viewerMemberIds, "all", null)
          )
        : Promise.resolve<Settled<LocalPageResult>>({
            ok: true,
            value: {
              page: { items: [], nextCursor: null },
              unreadCount: 0,
            },
          }),
      canLoadCloud && scope.accessToken && scope.activeCloudOrgId
        ? settle(
            this.dependencies.listInitialMentions(
              scope.accessToken,
              scope.activeCloudOrgId,
              50,
              runtime.scopeController.signal
            )
          )
        : Promise.resolve<Settled<TeamInboxMentionsPage>>({
            ok: true,
            value: { mentions: [], unreadCount: 0 },
          }),
    ])
      .then(([local, cloud]) => {
        const currentRuntime = this.runtimeByStore.get(store);
        if (
          currentRuntime !== runtime ||
          generation !== runtime.generation ||
          runtime.scopeController.signal.aborted ||
          runtime.desiredRefreshVersion !== requestVersion
        ) {
          return;
        }

        const previous = store.get(teamInboxCacheAtom);
        const sameScope = previous.loadedForViewerKey === scope.key;
        const previousLocal = sameScope
          ? previous.items.filter((item) => item.source !== "cloud")
          : [];
        const previousCloud = sameScope
          ? previous.items.filter((item) => item.source === "cloud")
          : [];
        const failures = [
          ...(local.ok ? [] : [local.error]),
          ...(cloud.ok ? [] : [cloud.error]),
        ];

        const localItems = local.ok ? local.value.page.items : previousLocal;
        const cloudItems = cloud.ok
          ? mapMentionsToItems(
              cloud.value.mentions,
              scope.activeCloudOrgId ?? ""
            )
          : previousCloud;
        if (local.ok) {
          runtime.localUnreadCounts = localUnreadCounts(local.value);
        }
        if (cloud.ok) {
          runtime.cloudUnreadCount = cloud.value.unreadCount;
        }
        const localUnread = runtime.localUnreadCounts;
        const cloudUnread = runtime.cloudUnreadCount;

        if (local.ok) runtime.localCursor = local.value.page.nextCursor;
        if (cloud.ok) runtime.cloudCursor = cloud.value.nextCursor ?? null;

        const items = boundedItems(
          resolveTeamInboxMemberNames(
            [...cloudItems, ...localItems],
            scope.members
          )
        );
        if (items.length >= MAX_CACHED_TEAM_INBOX_ITEMS) {
          runtime.localCursor = null;
          runtime.cloudCursor = null;
        }
        const unreadCount = localUnread.all + cloudUnread;
        const issue = mergeIssues(
          issueForFailures(failures, requestedSourceCount),
          prerequisiteIssueForScope(scope)
        );
        const hasMore = Boolean(runtime.localCursor || runtime.cloudCursor);
        store.set(teamInboxCacheAtom, (current) => {
          const itemsUnchanged = isEqual(current.items, items);
          const snapshotUnchanged =
            itemsUnchanged &&
            current.unreadCount === unreadCount &&
            current.unreadCounts.all === unreadCount &&
            current.unreadCounts.mentions ===
              localUnread.mentions + cloudUnread &&
            current.unreadCounts.assigned === localUnread.assigned &&
            !current.loading &&
            sameIssue(current.issue, issue) &&
            current.loadedForViewerKey === scope.key &&
            current.hasMore === hasMore;
          if (snapshotUnchanged) return current;
          return {
            ...current,
            items: itemsUnchanged ? current.items : items,
            unreadCount,
            unreadCounts: {
              all: unreadCount,
              mentions: localUnread.mentions + cloudUnread,
              assigned: localUnread.assigned,
            },
            loading: false,
            issue,
            loadedForViewerKey: scope.key,
            hasMore,
            revision: current.revision + 1,
          };
        });
      })
      .finally(() => {
        if (runtime.refreshPromise === promise) {
          runtime.refreshPromise = null;
        }
        const queued = runtime.queuedRefresh;
        runtime.queuedRefresh = null;
        if (
          queued &&
          this.runtimeByStore.get(store) === runtime &&
          !runtime.scopeController.signal.aborted
        ) {
          void this.refresh(store, queued.scope, queued.version);
        }
      });
    runtime.refreshPromise = promise;
    return promise;
  }

  loadMore(store: Store, scope: TeamInboxCoordinatorScope): Promise<void> {
    const runtime = this.ensureScope(store, scope.key);
    return loadMoreTeamInbox(this.context, store, runtime, scope);
  }

  markRead(
    store: Store,
    scope: TeamInboxCoordinatorScope,
    item: TeamInboxItem
  ): Promise<void> {
    return this.setReadState(store, scope, item, true);
  }

  markUnread(
    store: Store,
    scope: TeamInboxCoordinatorScope,
    item: TeamInboxItem
  ): Promise<void> {
    return this.setReadState(store, scope, item, false);
  }

  private setReadState(
    store: Store,
    scope: TeamInboxCoordinatorScope,
    item: TeamInboxItem,
    read: boolean
  ): Promise<void> {
    const runtime = this.ensureScope(store, scope.key);
    return setTeamInboxReadState(
      this.context,
      store,
      runtime,
      scope,
      item,
      read
    );
  }

  markAllRead(
    store: Store,
    scope: TeamInboxCoordinatorScope,
    filter: TeamInboxFilter
  ): Promise<void> {
    const runtime = this.ensureScope(store, scope.key);
    return markAllTeamInboxRead(this.context, store, runtime, scope, filter);
  }

  reconcileItem(
    store: Store,
    scopeKey: string,
    itemKey: string,
    nextItem: TeamInboxItem | null
  ): void {
    reconcileTeamInboxItem(
      this.runtimeByStore,
      store,
      scopeKey,
      itemKey,
      nextItem
    );
  }
}

const productionDependencies: TeamInboxCoordinatorDependencies = {
  listLocalPage: listLocalTeamInboxPage,
  listInitialMentions: listInitialTeamInboxMentions,
  listMentions: listTeamInboxMentions,
  markLocalRead: markLocalTeamInboxItemRead,
  markLocalUnread: markLocalTeamInboxItemUnread,
  markAllLocalRead: markAllLocalTeamInboxRead,
  setMentionRead: setTeamInboxMentionRead,
  markAllMentionsRead: markAllTeamInboxMentionsRead,
  now: () => new Date().toISOString(),
};

export const teamInboxCoordinator = new TeamInboxCoordinator(
  productionDependencies
);

export const TEAM_INBOX_CACHE_LIMIT = MAX_CACHED_TEAM_INBOX_ITEMS;
