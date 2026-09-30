import { useCallback, useMemo, useSyncExternalStore } from "react";

import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";

import { projectSubagentParentDetails } from "./subagentParentEventProjection";

/**
 * Read the parent's existing snapshot only. Opening the roster must not hydrate
 * a parent or fan out requests to child histories merely to decorate rows.
 * Subscription lifetime belongs to the mounted view; no atom-family cache.
 */
export function useCachedSubagentParentDetails(sessionId: string | null) {
  const subscribe = useCallback(
    (notify: () => void) => {
      if (!sessionId) return () => {};
      let unsubscribe = () => {};
      const resume = () => {
        unsubscribe();
        unsubscribe = () => {};
        if (document.hidden) return;
        unsubscribe = eventStoreProxy.subscribeSession(sessionId, notify);
        notify();
      };
      resume();
      document.addEventListener("visibilitychange", resume);
      return () => {
        unsubscribe();
        document.removeEventListener("visibilitychange", resume);
      };
    },
    [sessionId]
  );
  const read = useCallback(
    () =>
      sessionId ? eventStoreProxy.getLatestSessionSnapshot(sessionId) : null,
    [sessionId]
  );
  const snapshot = useSyncExternalStore(subscribe, read, () => null);
  const events = snapshot?.chatEvents;
  return useMemo(() => projectSubagentParentDetails(events ?? []), [events]);
}
