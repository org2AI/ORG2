import type { SubagentSession } from "@src/contracts/simulator/subagent";

import {
  type ChildSessionRecord,
  isSubagentTaskAssigned,
  mapChildSessionRecord,
} from "./subagentSessionProjection";

export interface SubagentRosterSnapshot {
  sessions: SubagentSession[];
  loaded: boolean;
  refreshing: boolean;
  error: string | null;
}

/** One bounded-lifetime request owner; refreshes keep the last successful roster.
 * Only observed resources run. Push invalidation is coalesced, with a 30s safety
 * check while live children exist (some imported providers do not push status). */
export function createSubagentRosterResource(
  load: () => Promise<ChildSessionRecord[]>,
  observe: (changed: (sessionId: string) => void) => () => void,
  visibility: Pick<
    Document,
    "hidden" | "addEventListener" | "removeEventListener"
  >
) {
  let state: SubagentRosterSnapshot = {
    sessions: [],
    loaded: false,
    refreshing: false,
    error: null,
  };
  const listeners = new Set<() => void>();
  let generation = 0;
  let pending: Promise<void> | null = null;
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let nextRefreshAt = 0;
  let release: ReturnType<typeof setTimeout> | undefined;
  let unobserve: (() => void) | undefined;
  let revision: number | undefined;
  const publish = (next: SubagentRosterSnapshot) => {
    state = next;
    listeners.forEach((listener) => listener());
  };
  const schedule = (delay: number) => {
    clearTimeout(timer);
    timer = undefined;
    if (!listeners.size || visibility.hidden) return;
    nextRefreshAt = Date.now() + delay;
    timer = setTimeout(() => {
      timer = undefined;
      void refresh();
    }, delay);
  };
  const refresh = (): Promise<void> => {
    if (!listeners.size || visibility.hidden) {
      dirty = true;
      return Promise.resolve();
    }
    if (pending) {
      dirty = true;
      return pending;
    }
    clearTimeout(timer);
    timer = undefined;
    dirty = false;
    const requestGeneration = generation;
    publish({ ...state, refreshing: true, error: null });
    const request = load()
      .then((records) => {
        if (requestGeneration !== generation) return;
        const sessions = records
          .filter((record) =>
            isSubagentTaskAssigned(record.name || record.sessionId)
          )
          .map((record) => mapChildSessionRecord(record, Date.now()))
          .sort(
            (a, b) =>
              Number(a.isTerminal) - Number(b.isTerminal) ||
              b.startedAtMs - a.startedAtMs ||
              a.sessionId.localeCompare(b.sessionId)
          );
        publish({ sessions, loaded: true, refreshing: false, error: null });
      })
      .catch((error: unknown) => {
        if (requestGeneration === generation)
          publish({ ...state, refreshing: false, error: String(error) });
      })
      .finally(() => {
        pending = null;
        if (requestGeneration !== generation) {
          if (listeners.size) schedule(0);
          return;
        }
        if (dirty) schedule(1000);
        else if (
          state.error ||
          state.sessions.some((session) => !session.isTerminal)
        )
          schedule(30_000);
      });
    pending = request;
    return request;
  };
  const invalidate = () => {
    dirty = true;
    // Do not keep postponing a refresh during continuous streaming.
    if (!pending && (timer === undefined || nextRefreshAt > Date.now() + 1000))
      schedule(1000);
  };
  const visibilityChanged = () => {
    clearTimeout(timer);
    timer = undefined;
    if (!visibility.hidden) void refresh();
  };
  return {
    getSnapshot: () => state,
    refresh,
    invalidate,
    setRevision: (next: number) => {
      if (revision === next) return;
      const previous = revision;
      revision = next;
      if (previous !== undefined) invalidate();
    },
    subscribe(listener: () => void) {
      clearTimeout(release);
      listeners.add(listener);
      if (listeners.size === 1) {
        unobserve = observe((id) => {
          if (!id || state.sessions.some((session) => session.sessionId === id))
            invalidate();
        });
        visibility.addEventListener("visibilitychange", visibilityChanged);
        const mountedGeneration = generation;
        queueMicrotask(() => {
          if (listeners.size && mountedGeneration === generation && !pending)
            void refresh();
        });
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size) return;
        clearTimeout(timer);
        timer = undefined;
        unobserve?.();
        visibility.removeEventListener("visibilitychange", visibilityChanged);
        // Discard completions after the owner closes; retain successful rows
        // only for a short reopen window, never an app-lifetime history cache.
        generation += 1;
        // Keep the in-flight promise until settlement so rapid reopen cannot
        // duplicate an IPC request. Its retired generation cannot publish.
        state = { ...state, refreshing: false };
        release = setTimeout(() => {
          state = {
            sessions: [],
            loaded: false,
            refreshing: false,
            error: null,
          };
        }, 60_000);
      };
    },
  };
}
