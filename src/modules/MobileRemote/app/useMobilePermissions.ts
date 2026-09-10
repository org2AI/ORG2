import { useCallback, useRef, useState } from "react";

import type { PermissionSheetRequest } from "@src/components/PermissionPrompt";

import type { MobileRpcClient } from "../connection/mobileRpcClient";
import {
  type InteractionQueueState,
  type PermissionBusEnvelope,
  countPermissionRequests,
  dequeuePermissionRequest,
  peekPermissionRequest,
  reduceInteractionQueueFromBusEvent,
} from "../lib/interactionQueue";

/** Owns permission decisions; it never creates a transport or navigates. */
export function useMobilePermissions({
  sessionId,
  demoMode,
  requireWritableClient,
}: {
  sessionId: string | null;
  demoMode: boolean;
  requireWritableClient: () => MobileRpcClient;
}) {
  const [queue, setQueue] = useState<InteractionQueueState>({ queue: [] });
  const [permissionSubmitting, setSubmitting] = useState(false);
  const inFlight = useRef<symbol | null>(null);
  const resetPermissions = useCallback(
    (requests: PermissionSheetRequest[] = []) => {
      inFlight.current = null;
      setSubmitting(false);
      setQueue({ queue: requests });
    },
    []
  );
  const receivePermissionEvent = useCallback((event: PermissionBusEnvelope) => {
    setQueue((previous) => reduceInteractionQueueFromBusEvent(previous, event));
  }, []);
  const respondPermission = useCallback(
    async (response: "allow" | "deny" | "always_allow") => {
      const head = peekPermissionRequest(queue, sessionId);
      if (!head || inFlight.current) return;
      const token = Symbol("permission-response");
      inFlight.current = token;
      setSubmitting(true);
      try {
        if (!demoMode) {
          await requireWritableClient().call("interaction/respond_permission", {
            sessionId: head.sessionId,
            requestId: head.requestId,
            response,
            origin: head.origin ?? "rust_agent",
          });
        }
        if (inFlight.current !== token) return;
        setQueue((previous) =>
          dequeuePermissionRequest(previous, head.requestId)
        );
      } finally {
        if (inFlight.current === token) {
          inFlight.current = null;
          setSubmitting(false);
        }
      }
    },
    [queue, sessionId, demoMode, requireWritableClient]
  );
  const dismissPermissionHead = useCallback(() => {
    if (inFlight.current) return;
    const head = peekPermissionRequest(queue, sessionId);
    if (head)
      setQueue((previous) =>
        dequeuePermissionRequest(previous, head.requestId)
      );
  }, [queue, sessionId]);
  return {
    activePermission: peekPermissionRequest(queue, sessionId),
    permissionQueueDepth: countPermissionRequests(queue, sessionId),
    permissionSubmitting,
    respondPermission,
    dismissPermissionHead,
    resetPermissions,
    receivePermissionEvent,
  };
}
