import { createLogger } from "@src/hooks/logger";

import type { MobileRpcClient } from "../connection/mobileRpcClient";

const BATCH = 200;
const MAX_WATCHED = 1200;
const EMPTY: ReadonlyMap<string, boolean> = new Map();

function visitedReply(
  value: unknown,
  requested: readonly string[]
): Set<string> {
  const ids = (value as { visitedIds?: unknown } | null)?.visitedIds;
  if (
    !Array.isArray(ids) ||
    ids.length > requested.length ||
    ids.some((id) => typeof id !== "string" || !requested.includes(id))
  ) {
    throw new Error("Invalid read-state response");
  }
  return new Set(ids);
}

/** Provider-lifetime, connection-scoped projection. No polling, persistent
 * phone truth, or transcript fetches. One RPC in flight; bursts coalesce. */
export function createMobileReadStateSync() {
  let client: MobileRpcClient | null = null;
  let scope: string | null = null;
  let generation = 0;
  let revision = 0;
  let watched: string[] = [];
  const pending = new Set<string>();
  let snapshot = EMPTY;
  let dirty = false;
  let running: number | null = null;
  let unlisten: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const emit = (next: ReadonlyMap<string, boolean>) => {
    if (
      next.size === snapshot.size &&
      [...next].every(([id, value]) => snapshot.get(id) === value)
    )
      return;
    snapshot = next;
    listeners.forEach((fn) => fn());
  };
  const pump = () => {
    if (!client || running === generation || (!dirty && pending.size === 0))
      return;
    const transport = client;
    const token = generation;
    const current = () => token === generation && client === transport;
    running = token;
    void Promise.resolve()
      .then(async () => {
        try {
          while (current() && (dirty || pending.size > 0)) {
            dirty = false;
            const marks = [...pending].slice(0, BATCH);
            if (marks.length) {
              const reply = visitedReply(
                await transport.call("session/mark_visited", {
                  sessionIds: marks,
                }),
                marks
              );
              if (!current()) return;
              if (marks.some((id) => !reply.has(id)))
                throw new Error("Desktop did not acknowledge the read receipt");
              marks.forEach((id) => pending.delete(id));
            }
            const requestRevision = revision;
            const ids = watched;
            const next = new Map<string, boolean>();
            for (let offset = 0; offset < ids.length; offset += BATCH) {
              const batch = ids.slice(offset, offset + BATCH);
              const reply = visitedReply(
                await transport.call("session/read_state", {
                  sessionIds: batch,
                }),
                batch
              );
              if (!current()) return;
              if (requestRevision !== revision) break;
              batch.forEach((id) => next.set(id, reply.has(id)));
            }
            if (!current()) return;
            if (requestRevision === revision) emit(next);
          }
        } catch {
          // Unknown is not unread. Retain pending receipts for the next explicit
          // activation, invalidation, or reconnect; never spin on failure.
          if (current()) emit(EMPTY);
        } finally {
          if (running === token) running = null;
        }
      })
      .catch((error) => logger.warn("Background operation failed", error));
  };
  const refresh = () => {
    revision++;
    dirty = true;
    pump();
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    connect(next: MobileRpcClient | null, nextScope: string) {
      if (next === client && scope === nextScope) return;
      unlisten?.();
      unlisten = undefined;
      generation++;
      if (scope !== nextScope) {
        pending.clear();
        // Never send the previous account/desktop's visible IDs to its successor.
        if (scope !== null) watched = [];
      }
      scope = nextScope;
      client = next;
      emit(EMPTY);
      unlisten = next?.onNotification((method) => {
        if (method === "session/read_state_changed") refresh();
      });
      refresh();
    },
    watch(ids: readonly string[]) {
      const next = [...new Set(ids)]
        .filter((id) => id.length > 0 && id.length <= 1024)
        .slice(0, MAX_WATCHED);
      if (
        next.length === watched.length &&
        next.every((id, index) => watched[index] === id)
      )
        return;
      watched = next;
      // Do not show state for the previously visible list while querying.
      emit(EMPTY);
      refresh();
    },
    markVisited(id: string) {
      if (
        !id ||
        id.length > 1024 ||
        pending.has(id) ||
        snapshot.get(id) === true
      )
        return;
      // Bounded navigation intent queue, retained only within this Desktop scope.
      if (pending.size >= BATCH) return;
      pending.add(id);
      refresh();
    },
    refresh,
    dispose() {
      generation++;
      client = null;
      unlisten?.();
      unlisten = undefined;
      pending.clear();
      watched = [];
      emit(EMPTY);
    },
  };
}

export type MobileReadStateSync = ReturnType<typeof createMobileReadStateSync>;

const logger = createLogger("mobileReadStateSync");
