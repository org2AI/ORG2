/**
 * Visited Sessions Atom
 *
 * Tracks which session IDs the user has opened at least once. Drives the
 * "Completed: Unread" Kanban column and the unread dot badge in the sidebar.
 *
 * Stored as a string[] in localStorage (Set is not JSON-serializable).
 * `visitedSessionsAtom` exposes a Set<string> for O(1) lookup at read sites.
 */
import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { z } from "zod/v4";

import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";
import { createZodJsonStorage } from "@src/util/core/storage/zodStorage";

const STORAGE_KEY = "orgii:visited-sessions";

/** Cap to prevent unbounded localStorage growth across thousands of sessions. */
const MAX_VISITED_IDS = 5_000;

const VisitedSessionIdsStorageSchema = z
  .array(z.string().min(1))
  .transform((ids) => [...new Set(ids)].slice(0, MAX_VISITED_IDS));
const visitedStorage = createZodJsonStorage(VisitedSessionIdsStorageSchema);

/**
 * Raw localStorage-backed list of visited session IDs.
 * Most-recently-visited first; old entries fall off when MAX_VISITED_IDS is hit.
 */
export const visitedSessionIdsAtom = atomWithStorage<string[]>(
  STORAGE_KEY,
  [],
  visitedStorage,
  { getOnInit: true }
);
visitedSessionIdsAtom.debugLabel = "visitedSessionIdsAtom";

/** Read-only Set view for O(1) `has()` lookups. */
export const visitedSessionsAtom = atom<Set<string>>((get) => {
  const ids = get(visitedSessionIdsAtom);
  return new Set(ids);
});
visitedSessionsAtom.debugLabel = "visitedSessionsAtom";

/**
 * Mark a session as visited. Idempotent: a no-op if the ID is already at the
 * head of the list. Promotes existing entries to the front (LRU).
 */
export function markSessionVisited(sessionId: string): void {
  if (!sessionId) return;
  const store = getInstrumentedStore();
  store.set(visitedSessionIdsAtom, (prev) => {
    if (prev[0] === sessionId) return prev;
    const filtered = prev.filter((id) => id !== sessionId);
    const next = [sessionId, ...filtered];
    return next.length > MAX_VISITED_IDS
      ? next.slice(0, MAX_VISITED_IDS)
      : next;
  });
}

/**
 * Mark a batch of sessions as visited. Used by the sidebar's "Mark All Read"
 * action — adds every passed ID to the visited list in a single store write
 * so the unread badge for each row clears in one render pass.
 */
export function markAllSessionsVisited(sessionIds: readonly string[]): void {
  if (sessionIds.length === 0) return;
  const store = getInstrumentedStore();
  store.set(visitedSessionIdsAtom, (prev) => {
    const incoming = [...new Set(sessionIds.filter(Boolean))];
    if (incoming.length === 0) return prev;
    const incomingSet = new Set(incoming);
    const carryOver = prev.filter((id) => !incomingSet.has(id));
    const next = [...incoming, ...carryOver];
    const bounded = next.slice(0, MAX_VISITED_IDS);
    return bounded.length === prev.length &&
      bounded.every((id, index) => id === prev[index])
      ? prev
      : bounded;
  });
}

export const __VISITED_SESSIONS_INTERNALS = {
  STORAGE_KEY,
  MAX_VISITED_IDS,
};

/** Remote callers need a durable acknowledgment, unlike local navigation
 * which intentionally remains usable under a storage-quota failure. */
export function markAllSessionsVisitedPersisted(
  sessionIds: readonly string[]
): void {
  markAllSessionsVisited(sessionIds);
  const ids = getInstrumentedStore().get(visitedSessionIdsAtom);
  const serialized = JSON.stringify(ids);
  if (localStorage.getItem(STORAGE_KEY) !== serialized) {
    // A retry must persist even when the in-memory mark is already present.
    visitedStorage.setItem(STORAGE_KEY, ids);
  }
  if (localStorage.getItem(STORAGE_KEY) !== serialized) {
    throw new Error("Could not persist visited sessions");
  }
}
