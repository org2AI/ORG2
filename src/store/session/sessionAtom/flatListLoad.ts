/**
 * Legacy flat session list: one "load everything (with limit/offset)" read
 * across all categories, for panels that want a single list.
 */
import {
  type SessionFilter,
  type SessionListResponse,
  sessionAggregateList,
  toFrontendSessions,
} from "@src/api/tauri/session";

import {
  dataSourceConfigAtom,
  externalSessionsEnabledAtom,
} from "../dataSourceConfigAtom";
import {
  sessionErrorAtom,
  sessionFlatListLastLoadedBySignatureAtom,
  sessionLoadingAtom,
  sessionsAtom,
} from "./atoms";
import { mergeGuestImportedSessions } from "./guestImportRegistry";
import { BULK_CACHE_DURATION_MS, getStore, log } from "./loaderShared";
import {
  type LoadSessionsOptions,
  loadSessionsCacheSignature,
  preserveImportedReplayRows,
} from "./mergeSessions";
import { persistSessions } from "./persistence";
import type { Session } from "./types";

const DEFAULT_FLAT_LIST_PAGE_SIZE = 200;

export const loadSessions = async (options?: LoadSessionsOptions) => {
  const store = getStore();
  const { forceRefresh = false } = options || {};
  const cacheSignature = loadSessionsCacheSignature(options);

  const lastLoaded = store.get(sessionFlatListLastLoadedBySignatureAtom)[
    cacheSignature
  ];
  const now = Date.now();

  if (
    !forceRefresh &&
    lastLoaded &&
    now - lastLoaded < BULK_CACHE_DURATION_MS
  ) {
    return;
  }

  store.set(sessionLoadingAtom, true);
  store.set(sessionErrorAtom, null);

  try {
    const filter: SessionFilter | undefined =
      options?.repoPath ||
      options?.orgId ||
      options?.projectSlug ||
      options?.workItemId ||
      options?.status ||
      options?.limit ||
      options?.offset
        ? {
            repoPath: options?.repoPath,
            orgId: options?.orgId,
            projectSlug: options?.projectSlug,
            workItemId: options?.workItemId,
            status: options?.status,
            limit: options?.limit,
            offset: options?.offset,
          }
        : undefined;

    const disabledSources = Object.entries(store.get(dataSourceConfigAtom))
      .filter(([, cfg]) => cfg?.enabled === false)
      .map(([sourceId]) => sourceId);

    const response = await sessionAggregateList({
      ...filter,
      limit: filter?.limit ?? DEFAULT_FLAT_LIST_PAGE_SIZE,
      includeExternalHistory: store.get(externalSessionsEnabledAtom),
      sortBy: filter?.sortBy ?? "updated_at",
      sortOrder: filter?.sortOrder ?? "desc",
      disabledExternalHistorySources:
        disabledSources.length > 0 ? disabledSources : undefined,
    });

    const fetched: Session[] = mergeGuestImportedSessions(
      toFrontendSessions((response as SessionListResponse).sessions)
    );

    fetched.sort((sessionA, sessionB) =>
      (sessionB.updated_at || "").localeCompare(sessionA.updated_at || "")
    );

    store.set(sessionsAtom, (prev) =>
      preserveImportedReplayRows(prev, fetched)
    );
    persistSessions(fetched);
    store.set(sessionFlatListLastLoadedBySignatureAtom, (prev) => ({
      ...prev,
      [cacheSignature]: now,
    }));
  } catch (error) {
    log.error("[SessionAtom] Failed to load sessions:", error);
    store.set(
      sessionErrorAtom,
      error instanceof Error ? error.message : "Failed to load sessions"
    );
  } finally {
    store.set(sessionLoadingAtom, false);
  }
};
