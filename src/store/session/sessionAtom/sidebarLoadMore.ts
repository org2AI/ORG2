/**
 * "Load more" for one sidebar roster category: fetch the next page, check
 * that it advanced the roster, and merge it in.
 */
import { isImportedHistoryListCategory } from "@src/api/tauri/externalHistory";
import { isPrimarySessionListSession } from "@src/util/session/sessionVisibility";

import { sessionsAtom } from "./atoms";
import { importedPageHasProgress } from "./importedHistoryPaging";
import { getStore, log, openSessionKeepIds } from "./loaderShared";
import { mergeAuthoritativeSessions, setPaginationFor } from "./mergeSessions";
import {
  SESSION_SIDEBAR_PAGE_SIZE,
  type SessionListCategory,
  type SessionPaginationMap,
  sessionPaginationAtom,
} from "./paginationAtoms";
import { persistSessions } from "./persistence";
import {
  currentSidebarRosterGeneration,
  loadCategoryPage,
  nextSidebarRosterGeneration,
} from "./sidebarLoad";
import type { Session } from "./types";

export interface SidebarPageLoadResult {
  category: SessionListCategory;
  phase: SessionPaginationMap[SessionListCategory]["phase"];
  newSessionIds: readonly string[];
  sessions: readonly Session[];
}

export const loadMoreCategory = async (
  category: SessionListCategory,
  pageSize: number = SESSION_SIDEBAR_PAGE_SIZE
): Promise<SidebarPageLoadResult> => {
  const store = getStore();
  const current = store.get(sessionPaginationAtom)[category];
  if (current.phase === "loading" || current.phase === "exhausted") {
    return {
      category,
      phase: current.phase,
      newSessionIds: [],
      sessions: [],
    };
  }

  const generation =
    currentSidebarRosterGeneration(store) || nextSidebarRosterGeneration(store);
  setPaginationFor(category, { phase: "loading" });

  try {
    const { sessions, hasMore, nextCursor, dateBuckets } =
      await loadCategoryPage(
        category,
        current.cursor,
        pageSize,
        current.dateBuckets
      );
    if (generation !== currentSidebarRosterGeneration(store)) {
      return {
        category,
        phase: store.get(sessionPaginationAtom)[category].phase,
        newSessionIds: [],
        sessions: [],
      };
    }
    const primarySessions = sessions.filter(isPrimarySessionListSession);
    const returnedIds = [
      ...new Set(primarySessions.map((session) => session.session_id)),
    ];
    const imported = isImportedHistoryListCategory(category);
    const replacingFirstPage =
      current.phase === "error" &&
      (imported
        ? !importedPageHasProgress(current.dateBuckets)
        : current.cursor === null);
    const previousIds = new Set(current.sessionIds);
    const newSessionIds = replacingFirstPage
      ? returnedIds
      : returnedIds.filter((sessionId) => !previousIds.has(sessionId));
    if (
      !replacingFirstPage &&
      returnedIds.length > 0 &&
      newSessionIds.length === 0
    ) {
      throw new Error(
        `${category} pagination returned no new roster IDs; cursor was not advanced`
      );
    }
    if (hasMore && returnedIds.length === 0) {
      throw new Error(
        `${category} pagination returned hasMore without roster IDs`
      );
    }
    const sessionIds = replacingFirstPage
      ? returnedIds
      : [...current.sessionIds, ...newSessionIds];
    store.set(sessionsAtom, (prev) =>
      mergeAuthoritativeSessions(prev, primarySessions, openSessionKeepIds())
    );
    setPaginationFor(category, {
      sessionIds,
      cursor: imported ? null : (nextCursor ?? current.cursor),
      phase: hasMore ? "ready" : "exhausted",
      generation,
      dateBuckets,
    });
    persistSessions(store.get(sessionsAtom));
    const newIds = new Set(newSessionIds);
    return {
      category,
      phase: hasMore ? "ready" : "exhausted",
      newSessionIds,
      sessions: primarySessions.filter((session) =>
        newIds.has(session.session_id)
      ),
    };
  } catch (error) {
    log.warn(`loadMoreCategory(${category}) failed:`, error);
    if (generation === currentSidebarRosterGeneration(store)) {
      setPaginationFor(category, { phase: "error", generation });
    }
    return {
      category,
      phase: "error",
      newSessionIds: [],
      sessions: [],
    };
  }
};
