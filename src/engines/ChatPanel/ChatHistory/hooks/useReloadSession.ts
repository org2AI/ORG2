import { useSetAtom, useStore } from "jotai";
import { useCallback } from "react";

import {
  clearSessionLoadErrorAtom,
  failSessionLoadAtom,
  loadStatusAtom,
  triggerSessionReloadAtom,
} from "@src/engines/SessionCore";
import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import { activeSessionIdAtom } from "@src/store/session";

export function useReloadSession(activeId: string | null) {
  const store = useStore();
  const failSessionLoad = useSetAtom(failSessionLoadAtom);
  const clearSessionLoadError = useSetAtom(clearSessionLoadErrorAtom);
  const setLoadStatus = useSetAtom(loadStatusAtom);
  const triggerSessionReload = useSetAtom(triggerSessionReloadAtom);
  const setActiveSessionId = useSetAtom(activeSessionIdAtom);

  return useCallback(async () => {
    if (!activeId) return;
    try {
      await eventStoreProxy.evictSession(activeId);
    } catch (error) {
      if (store.get(activeSessionIdAtom) === activeId) {
        failSessionLoad(error instanceof Error ? error.message : String(error));
      }
      return;
    }
    // An eviction can finish after the user has selected a different session.
    if (store.get(activeSessionIdAtom) !== activeId) return;
    clearSessionLoadError();
    setLoadStatus("loading");
    setActiveSessionId(activeId);
    triggerSessionReload(activeId);
  }, [
    activeId,
    store,
    failSessionLoad,
    clearSessionLoadError,
    setActiveSessionId,
    setLoadStatus,
    triggerSessionReload,
  ]);
}
