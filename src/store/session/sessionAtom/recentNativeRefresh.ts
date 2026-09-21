/**
 * Bounded newest-first refresh of recent native session rows, for the
 * focused sidebar safety poll.
 */
import {
  sessionAggregateList,
  toFrontendSessions,
} from "@src/api/tauri/session";
import { isPrimarySessionListSession } from "@src/util/session/sessionVisibility";

import { sessionsAtom } from "./atoms";
import { getStore, openSessionKeepIds } from "./loaderShared";
import { mergeAuthoritativeSessions } from "./mergeSessions";
import {
  BASE_SESSION_LIST_CATEGORIES,
  SESSION_SIDEBAR_PAGE_SIZE,
  sessionPaginationAtom,
} from "./paginationAtoms";
import { persistSessions } from "./persistence";
import {
  sidebarCategoryForSession,
  syncSessionWithNativeRosters,
} from "./sidebarRoster";
import type { Session } from "./types";

const RECENT_NATIVE_REFRESH_LIMIT =
  SESSION_SIDEBAR_PAGE_SIZE * BASE_SESSION_LIST_CATEGORIES.length;
const recentNativeRefreshesByStore = new WeakMap<object, Promise<void>>();

/**
 * Refresh only the recent native rows that can be created by gateways and
 * other out-of-process surfaces.
 *
 * The focused sidebar safety poll exists so a `/newsession` command appears
 * without a manual reload. Running the full roster loader for that poll used
 * to fan out across every native category and every imported-history source
 * every 15 seconds. One bounded newest-first native query is sufficient for
 * discovery and preserves the paginated imported rows already in memory.
 */
export function refreshRecentNativeSessions(): Promise<void> {
  const store = getStore();
  const active = recentNativeRefreshesByStore.get(store);
  if (active) return active;

  const previousById = new Map(
    store
      .get(sessionsAtom)
      .map((session) => [session.session_id, session] as const)
  );
  const refresh = (async () => {
    const response = await sessionAggregateList({
      includeExternalHistory: false,
      limit: RECENT_NATIVE_REFRESH_LIMIT,
      sortBy: "updated_at",
      sortOrder: "desc",
    });
    const incoming = toFrontendSessions(response.sessions).filter(
      isPrimarySessionListSession
    );
    let merged: Session[] = [];
    store.set(sessionsAtom, (previous) => {
      merged = mergeAuthoritativeSessions(
        previous,
        incoming,
        openSessionKeepIds()
      );
      return merged;
    });
    const membershipChanges = incoming.filter((session) => {
      const previous = previousById.get(session.session_id);
      return (
        !previous ||
        sidebarCategoryForSession(previous) !==
          sidebarCategoryForSession(session)
      );
    });
    if (membershipChanges.length > 0) {
      store.set(sessionPaginationAtom, (previous) =>
        membershipChanges.reduce(
          (pagination, session) =>
            syncSessionWithNativeRosters(pagination, session),
          previous
        )
      );
    }
    persistSessions(merged);
  })().finally(() => {
    if (recentNativeRefreshesByStore.get(store) === refresh) {
      recentNativeRefreshesByStore.delete(store);
    }
  });
  recentNativeRefreshesByStore.set(store, refresh);
  return refresh;
}
