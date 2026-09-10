/**
 * Context-Aware Atoms
 *
 * Filtered views of events based on current thread selection.
 * Used by ActivitySimulator and ReplayControl for consistent behavior.
 */
import { atom } from "jotai";

import { selectedExecutionThreadAtom } from "@src/store/ui/sessionPaginationAtom";

import { sortedEventsAtom } from "./events";

// ============================================
// Effective Replay Context (Thread Aware)
// ============================================

/**
 * Events filtered by current thread selection.
 * - If thread selected: only that thread's events
 * - Otherwise: all events
 */
export const threadFilteredEventsAtom = atom((get) => {
  const events = get(sortedEventsAtom);
  const threadId = get(selectedExecutionThreadAtom);

  if (!threadId) return events;
  return events.filter((event) => event.threadId === threadId);
});
threadFilteredEventsAtom.debugLabel = "session/threadFilteredEvents";

/**
 * Effective events for replay — thread filter when a thread is selected,
 * otherwise all sorted events.
 */
export const effectiveEventsAtom = atom((get) => {
  return get(threadFilteredEventsAtom);
});
effectiveEventsAtom.debugLabel = "session/effectiveEvents";
