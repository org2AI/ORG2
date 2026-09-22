import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";

import { createLogger } from "@src/hooks/logger";
import { useSetting } from "@src/hooks/settings/useSettings";
import { startDesktopReadStateBridge } from "@src/store/session/desktopReadStateBridge";
import {
  markAllSessionsVisitedPersisted,
  visitedSessionsAtom,
} from "@src/store/session/visitedSessionsAtom";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";

const logger = createLogger("MobileSessionReadState");

export function useMobileSessionReadStateSync(): void {
  const [enabled] = useSetting("mobileRemote.enabled");
  useEffect(() => {
    if (!enabled || !isTauri() || getCurrentWindow().label !== "main") return;
    const store = getInstrumentedStore();
    return startDesktopReadStateBridge({
      listen: (handler) =>
        listen("mobile-session-read-request", (event) =>
          handler(event.payload)
        ),
      reply: (requestId, visitedIds) =>
        invoke("mobile_remote_reply_read_state", { requestId, visitedIds }),
      notifyChanged: () => invoke("mobile_remote_read_state_changed"),
      read: () => store.get(visitedSessionsAtom),
      mark: markAllSessionsVisitedPersisted,
      subscribe: (handler) => store.sub(visitedSessionsAtom, handler),
      onError: () =>
        logger.warn(
          "Read-state synchronization failed; will reconcile on the next request"
        ),
    });
  }, [enabled]);
}
