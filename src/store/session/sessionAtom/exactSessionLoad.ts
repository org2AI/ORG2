/**
 * Exact-id session hydration for deep links and cloud-scoped views that
 * target rows outside the paginated roster.
 */
import {
  sessionAggregateList,
  toFrontendSessions,
} from "@src/api/tauri/session";

import { externalSessionsEnabledAtom } from "../dataSourceConfigAtom";
import { sessionsAtom } from "./atoms";
import { getStore } from "./loaderShared";
import { mergeSessions } from "./mergeSessions";
import { persistSessions } from "./persistence";
import { exactSessionBatchLoadsForStore } from "./sidebarLoad";
import type { Session } from "./types";

/**
 * Hydrate canonical session rows by exact id.
 *
 * Normal sidebar loading is intentionally paginated per source/date bucket.
 * Deep links and cloud-scoped My Conversations can target much older rows, so
 * walking pages would be slow and nondeterministic. The aggregate API resolves
 * the exact ids in one bounded batch and merges only authoritative rows.
 */
export function loadSidebarSessionsByIds(
  sessionIds: readonly string[]
): Promise<Session[]> {
  const normalizedSessionIds = [
    ...new Set(sessionIds.map((sessionId) => sessionId.trim()).filter(Boolean)),
  ];
  if (normalizedSessionIds.length === 0) return Promise.resolve([]);

  const store = getStore();
  const exactSessionBatchLoads = exactSessionBatchLoadsForStore(store);
  // React effects and deep-link reveals can converge on the same exact rows.
  // Share that batch while it is active; entries are removed on settlement so
  // this coordinator cannot grow over the app lifetime.
  const requestKey = JSON.stringify([...normalizedSessionIds].sort());
  const existing = exactSessionBatchLoads.get(requestKey);
  if (existing) return existing;

  const request = (async (): Promise<Session[]> => {
    const response = await sessionAggregateList({
      sessionIds: normalizedSessionIds,
      includeExternalHistory: store.get(externalSessionsEnabledAtom),
      limit: normalizedSessionIds.length,
    });
    const requestedIds = new Set(normalizedSessionIds);
    const loaded = toFrontendSessions(response.sessions).filter((candidate) =>
      requestedIds.has(candidate.session_id)
    );
    if (loaded.length === 0) return [];

    store.set(sessionsAtom, (previous) => mergeSessions(previous, loaded));
    persistSessions(store.get(sessionsAtom));
    return loaded;
  })();
  const trackedRequest = request.finally(() => {
    if (exactSessionBatchLoads.get(requestKey) === trackedRequest) {
      exactSessionBatchLoads.delete(requestKey);
    }
  });
  exactSessionBatchLoads.set(requestKey, trackedRequest);
  return trackedRequest;
}

export const loadSidebarSessionById = async (
  sessionId: string
): Promise<Session | null> => {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) return null;

  // Do not return an existing atom row before resolving the canonical record.
  // Transcript activation can insert a lightweight row first; imported
  // subagent rows in particular need the provider cache's parentSessionId so
  // the sidebar can place them beneath the root session deterministically.
  const loaded = await loadSidebarSessionsByIds([normalizedSessionId]);
  return (
    loaded.find((session) => session.session_id === normalizedSessionId) ?? null
  );
};
