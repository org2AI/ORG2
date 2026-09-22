import type { Store } from "jotai/vanilla/store";

import type { TeamInboxMentionsPage } from "@src/features/Org2Cloud/teamInboxMentionsClient";

import { teamInboxCacheAtom } from "../store";
import {
  boundedItems,
  errorDetail,
  issueForFailures,
  mapMentionsToItems,
  mergeIssues,
  prerequisiteIssueForScope,
  resolveTeamInboxMemberNames,
} from "./items";
import {
  type CoordinatorRuntime,
  type LocalPageResult,
  MAX_CACHED_TEAM_INBOX_ITEMS,
  type Settled,
  type TeamInboxCoordinatorContext,
  type TeamInboxCoordinatorScope,
  localUnreadCounts,
  settle,
} from "./runtime";

export function loadMoreTeamInbox(
  { dependencies, runtimeByStore }: TeamInboxCoordinatorContext,
  store: Store,
  runtime: CoordinatorRuntime,
  scope: TeamInboxCoordinatorScope
): Promise<void> {
  if (runtime.loadMorePromise) return runtime.loadMorePromise;
  const localCursor = runtime.localCursor;
  const cloudCursor = runtime.cloudCursor;
  if (!localCursor && !cloudCursor) return Promise.resolve();

  const generation = runtime.generation;
  const requestedSourceCount =
    Number(Boolean(localCursor)) + Number(Boolean(cloudCursor));
  const promise = Promise.all([
    localCursor
      ? settle(
          dependencies.listLocalPage(scope.viewerMemberIds, "all", localCursor)
        )
      : Promise.resolve<Settled<LocalPageResult>>({
          ok: true,
          value: {
            page: { items: [], nextCursor: null },
            unreadCount: runtime.localUnreadCounts.all,
          },
        }),
    cloudCursor && scope.accessToken && scope.activeCloudOrgId
      ? settle(
          dependencies.listMentions(
            scope.accessToken,
            scope.activeCloudOrgId,
            cloudCursor,
            50,
            runtime.scopeController.signal
          )
        )
      : Promise.resolve<Settled<TeamInboxMentionsPage>>({
          ok: true,
          value: {
            mentions: [],
            unreadCount: store.get(teamInboxCacheAtom).unreadCounts.mentions,
          },
        }),
  ])
    .then(([local, cloud]) => {
      if (
        runtimeByStore.get(store) !== runtime ||
        generation !== runtime.generation ||
        runtime.scopeController.signal.aborted
      ) {
        return;
      }
      const failures = [
        ...(local.ok ? [] : [local.error]),
        ...(cloud.ok ? [] : [cloud.error]),
      ];
      if (localCursor && local.ok) {
        runtime.localCursor = local.value.page.nextCursor;
        runtime.localUnreadCounts = localUnreadCounts(local.value);
      }
      if (cloudCursor && cloud.ok) {
        runtime.cloudCursor = cloud.value.nextCursor ?? null;
        runtime.cloudUnreadCount = cloud.value.unreadCount;
      }
      const appended = resolveTeamInboxMemberNames(
        [
          ...(cloud.ok
            ? mapMentionsToItems(
                cloud.value.mentions,
                scope.activeCloudOrgId ?? ""
              )
            : []),
          ...(local.ok ? local.value.page.items : []),
        ],
        scope.members
      );
      store.set(teamInboxCacheAtom, (current) => {
        const items = boundedItems([...current.items, ...appended]);
        if (items.length >= MAX_CACHED_TEAM_INBOX_ITEMS) {
          runtime.localCursor = null;
          runtime.cloudCursor = null;
        }
        const assigned = runtime.localUnreadCounts.assigned;
        const mentions =
          runtime.localUnreadCounts.mentions + runtime.cloudUnreadCount;
        const all = runtime.localUnreadCounts.all + runtime.cloudUnreadCount;
        return {
          ...current,
          items,
          unreadCount: all,
          unreadCounts: {
            all,
            assigned,
            mentions,
          },
          issue: mergeIssues(
            issueForFailures(failures, requestedSourceCount),
            prerequisiteIssueForScope(scope)
          ),
          hasMore: Boolean(runtime.localCursor || runtime.cloudCursor),
          revision: current.revision + 1,
        };
      });
      if (failures.length >= requestedSourceCount) {
        throw new Error(errorDetail(failures) ?? "Team Inbox load failed");
      }
    })
    .finally(() => {
      if (runtime.loadMorePromise === promise) {
        runtime.loadMorePromise = null;
      }
    });
  runtime.loadMorePromise = promise;
  return promise;
}
