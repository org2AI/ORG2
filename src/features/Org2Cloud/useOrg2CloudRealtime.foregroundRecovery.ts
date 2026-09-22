/**
 * useOrg2CloudRealtime — conversation-plane foreground recovery.
 *
 * A short app switch stays inside the Realtime lease's blur grace, so no
 * reconnect edge exists to recover an at-most-once conversation signal.
 * Own this once at the Cloud realtime boundary and invalidate the org's
 * mounted conversation planes; each plane's existing after-seq loader owns
 * the actual bounded pull. This avoids one browser listener and direct RPC
 * path per mounted transcript surface.
 */
import { useEffect, useRef } from "react";

import { REALTIME_SIGNAL_COALESCE_MS } from "./org2CloudRealtimeSignalCoalescer";

export function useOrg2CloudConversationForegroundRecovery(args: {
  activeRealtimeOrgId: string | null;
  bumpConversationPlaneVersion: (orgId: string) => void;
  bumpActiveSessionCommentsSignal: (orgId: string) => void;
}): void {
  const {
    activeRealtimeOrgId,
    bumpConversationPlaneVersion,
    bumpActiveSessionCommentsSignal,
  } = args;
  const conversationForegroundRecoveryAtRef = useRef(0);
  useEffect(() => {
    if (
      !activeRealtimeOrgId ||
      typeof window === "undefined" ||
      typeof document === "undefined"
    ) {
      return undefined;
    }
    const recoverConversationPlanes = () => {
      if (document.visibilityState === "hidden") return;
      if (typeof document.hasFocus === "function" && !document.hasFocus()) {
        return;
      }
      const now = Date.now();
      if (
        now - conversationForegroundRecoveryAtRef.current <
        REALTIME_SIGNAL_COALESCE_MS
      ) {
        return;
      }
      conversationForegroundRecoveryAtRef.current = now;
      bumpConversationPlaneVersion(activeRealtimeOrgId);
      // Team Chat is owned by the comments loader, not the agent plane.
      // Force the active thread past its TTL after a missed foreground signal.
      bumpActiveSessionCommentsSignal(activeRealtimeOrgId);
    };
    window.addEventListener("focus", recoverConversationPlanes);
    window.addEventListener("online", recoverConversationPlanes);
    document.addEventListener("visibilitychange", recoverConversationPlanes);
    return () => {
      window.removeEventListener("focus", recoverConversationPlanes);
      window.removeEventListener("online", recoverConversationPlanes);
      document.removeEventListener(
        "visibilitychange",
        recoverConversationPlanes
      );
    };
  }, [
    activeRealtimeOrgId,
    bumpConversationPlaneVersion,
    bumpActiveSessionCommentsSignal,
  ]);
}
