import { useAtom, useAtomValue } from "jotai";
import { useEffect, useRef } from "react";

import type { BrowserState } from "@src/engines/BrowserCore/types";
import { focusBrowserUrlBar } from "@src/modules/WorkStation/Browser/shared/urlBarFocus";
import {
  workstationNewBrowserSessionConsumedTickAtom,
  workstationNewBrowserSessionRequestAtom,
} from "@src/store/workstation/workstationTabBarAtoms";

/**
 * Consumes cross-host Browser-session requests and focuses blank tabs only
 * after the new active session has committed, so the URL input is mounted and
 * listening before the focus event is scheduled.
 */
export function useNewBrowserSessionRequest(browserState: BrowserState): void {
  const request = useAtomValue(workstationNewBrowserSessionRequestAtom);
  const [consumedTick, setConsumedTick] = useAtom(
    workstationNewBrowserSessionConsumedTickAtom
  );
  const pendingFocusSessionIdRef = useRef<string | null>(null);
  const { activeSessionId, addSession, sessions } = browserState;

  useEffect(() => {
    if (request.tick <= consumedTick) return;

    setConsumedTick(request.tick);
    const sessionId = addSession(request.url, request.isPrivate);
    pendingFocusSessionIdRef.current = request.url ? null : sessionId;
  }, [
    request.tick,
    request.url,
    request.isPrivate,
    consumedTick,
    setConsumedTick,
    addSession,
  ]);

  useEffect(() => {
    const pendingSessionId = pendingFocusSessionIdRef.current;
    if (
      !pendingSessionId ||
      activeSessionId !== pendingSessionId ||
      !sessions.some((session) => session.id === pendingSessionId)
    ) {
      return;
    }

    pendingFocusSessionIdRef.current = null;
    focusBrowserUrlBar();
  }, [activeSessionId, sessions]);
}
