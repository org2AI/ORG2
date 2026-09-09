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

  return useCallback((): void => {
    if (!activeId) return;
    // UI actions are synchronous callbacks. This owner awaits eviction and
    // handles failures for the complete async reload operation.
    const reload = async () => {
      await eventStoreProxy.evictSession(activeId);
      // Eviction can finish after navigation to a different session.
      if (store.get(activeSessionIdAtom) !== activeId) return;
      clearSessionLoadError();
      setLoadStatus("loading");
      setActiveSessionId(activeId);
      triggerSessionReload(activeId);
    };
    reload().catch((error: unknown) => {
      if (store.get(activeSessionIdAtom) === activeId) {
        failSessionLoad(error instanceof Error ? error.message : String(error));
      }
    });
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
