/**
 * Session Loaders
 *
 * Two complementary loading paths:
 *
 *  - `loadSessions()` — legacy "load everything (with limit/offset)" entry
 *    used by panels that want a single flat list across all categories
 *    (Chat history panel and Simulator panel).
 *
 *  - `loadSessionRoster()` / `loadMoreCategory()` — the shared incremental
 *    roster consumed by Sidebar and every session Kanban mode. Native
 *    categories fetch one top-N page; imported sources fetch lightweight,
 *    independent date-bucket pages from ORGII's cache so a busy Today bucket
 *    cannot hide Yesterday.
 *
 * Split modules:
 *   loaderShared.ts           — logger, store accessor, FetchPageResult
 *   mergeSessions.ts          — roster merge + pagination patch primitives
 *   importedHistoryPaging.ts  — external-history date-bucket paging
 *   sidebarLoad.ts            — roster generation, category pages, coordinator
 *   flatListLoad.ts           — `loadSessions` flat-list read
 *   sidebarLoadMore.ts        — `loadMoreCategory` next-page read
 *   recentNativeRefresh.ts    — bounded recent native-row refresh
 *   exactSessionLoad.ts       — exact-id hydration for deep links
 */
import { isPrimarySessionListSession } from "@src/util/session/sessionVisibility";

import { replaceExternalHistorySourceFirstPage } from "./importedHistoryPaging";
import { getStore } from "./loaderShared";
import { mergeAuthoritativeSessions, mergeSessions } from "./mergeSessions";
import { sessionPaginationAtom } from "./paginationAtoms";
import {
  createSidebarLoadCoordinator,
  performSidebarSessionLoad,
} from "./sidebarLoad";
import { syncSessionWithNativeRosters } from "./sidebarRoster";
import type { Session } from "./types";

export {
  loadSidebarSessionById,
  loadSidebarSessionsByIds,
} from "./exactSessionLoad";
export { loadSessions } from "./flatListLoad";
export { refreshRecentNativeSessions } from "./recentNativeRefresh";
export { loadMoreCategory } from "./sidebarLoadMore";
export type { SidebarPageLoadResult } from "./sidebarLoadMore";

/**
 * One process-wide session-roster loader. Overlapping mounts/refreshes join the
 * active read; a stronger request (forced or larger page) is merged into one
 * follow-up pass instead of starting a parallel category fan-out.
 */
export const loadSessionRoster = createSidebarLoadCoordinator(
  performSidebarSessionLoad
);

/**
 * Compatibility alias for callers outside the roster surfaces. New Sidebar
 * and Kanban code should use `loadSessionRoster` so ownership is unambiguous.
 */
export const loadSidebarSessions = loadSessionRoster;

export function syncSidebarSessionRoster(session: Session): void {
  const store = getStore();
  store.set(sessionPaginationAtom, (previous) =>
    syncSessionWithNativeRosters(previous, session)
  );
}

/**
 * Register a locally-created native session before the next roster read.
 * Unlike status/pin projections, creation is a membership change and must
 * remain visible even while the sidebar's first page is still loading.
 */
export function registerNewNativeSidebarSession(session: Session): void {
  if (!isPrimarySessionListSession(session)) return;
  const store = getStore();
  store.set(sessionPaginationAtom, (previous) =>
    syncSessionWithNativeRosters(previous, session, {
      registerBeforeInitialPage: true,
    })
  );
}

export const __TESTS_ONLY = {
  createSidebarLoadCoordinator,
  mergeAuthoritativeSessions,
  mergeSessions,
  replaceExternalHistorySourceFirstPage,
};
