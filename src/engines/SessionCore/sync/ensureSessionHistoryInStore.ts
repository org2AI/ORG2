import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import {
  isCursorIdeSession,
  isImportedHistorySession,
} from "@src/util/session/sessionDispatch";

import { ensureCursorIdeEventsInStore } from "./adapters/cursorIdeAdapter";
import { externalHistoryAdapter } from "./adapters/externalHistoryAdapter";

// Only in-flight work is retained. The EventStore owns loaded history and its
// eviction; the source adapter owns the bounded initial window, not this reader.
const pending = new Map<string, Promise<void>>();

/** Hydrate session-scoped readers without switching the main chat session. */
export function ensureSessionHistoryInStore(
  sessionId: string,
  options: { forceReload?: boolean } = {}
): Promise<void> {
  const existing = pending.get(sessionId);
  if (existing) return existing;
  const request = hydrate(sessionId, options.forceReload === true);
  pending.set(sessionId, request);
  void request
    .finally(() => {
      if (pending.get(sessionId) === request) pending.delete(sessionId);
    })
    .catch(() => {});
  return request;
}

async function hydrate(sessionId: string, forceReload: boolean): Promise<void> {
  if (isCursorIdeSession(sessionId)) {
    await ensureCursorIdeEventsInStore(sessionId, { forceReload });
    return;
  }
  if (!isImportedHistorySession(sessionId)) {
    await eventStoreProxy.loadFromCache(sessionId);
    return;
  }
  const before =
    eventStoreProxy.getLatestSessionSnapshot(sessionId) ??
    (await eventStoreProxy.getSnapshot(sessionId));
  // Scoped readers only fill an empty store. Refreshing a populated projection
  // belongs to the main history owner, which also owns expanded/older turns.
  if (before.eventCount > 0) return;
  // loadHistory is the normal bounded preview, never loadAuthoritativeHistory.
  const events = await externalHistoryAdapter.loadHistory(
    sessionId,
    new AbortController().signal
  );
  const current = eventStoreProxy.getLatestSessionSnapshot(sessionId);
  // A main-chat/turn loader may have populated this same session meanwhile.
  // Do not replace its newer or more complete projection with our initial page.
  if (current !== before && current && current.eventCount > 0) return;
  try {
    await eventStoreProxy.set(events, sessionId, before.version);
  } catch (error) {
    // The Rust store checks the version atomically: a concurrent chat load or
    // streamed event can win even before its notification reaches this reader.
    const latest = await eventStoreProxy.getSnapshot(sessionId);
    if (latest.version !== before.version && latest.eventCount > 0) return;
    throw error;
  }
  await eventStoreProxy.getSnapshot(sessionId);
}
