import { useCallback, useEffect, useRef, useState } from "react";

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
  const [failedRequestKey, setFailed] = useState<string | null>(null);
  const [preferredRequestId, focusPermission] = useState<string | null>(null);
  const head =
    queue.queue.find(
      (row) =>
        row.requestId === preferredRequestId && row.sessionId === sessionId
    ) ?? peekPermissionRequest(queue, sessionId);
  const requestKey = head
    ? JSON.stringify([head.sessionId, head.requestId])
    : null;
  const permissionFailed =
    requestKey !== null && failedRequestKey === requestKey;
  const inFlight = useRef<symbol | null>(null);
  // A result belongs to the visible request, never the next prompt or session.
  useEffect(() => {
    inFlight.current = null;
    setSubmitting(false);
    setFailed(null);
    return () => {
      inFlight.current = null;
    };
  }, [head?.sessionId, head?.requestId]);
  const resetPermissions = useCallback(
    (requests: PermissionSheetRequest[] = []) => {
      inFlight.current = null;
      setSubmitting(false);
      setFailed(null);
      focusPermission(null);
      setQueue({ queue: requests });
    },
    []
  );
  const receivePermissionEvent = useCallback((event: PermissionBusEnvelope) => {
    setQueue((previous) => reduceInteractionQueueFromBusEvent(previous, event));
  }, []);
  const reconcilePermissions = useCallback(
    (requests: PermissionSheetRequest[]) => {
      setQueue({ queue: requests });
    },
    []
  );
  const reconcileSessionPermissions = useCallback(
    (sessionId: string, requests: PermissionSheetRequest[]) => {
      setQueue((previous) => ({
        queue: [
          ...previous.queue.filter((row) => row.sessionId !== sessionId),
          ...requests.filter((row) => row.sessionId === sessionId),
        ],
      }));
    },
    []
  );
  const respondPermission = useCallback(
    async (response: "allow" | "deny" | "always_allow") => {
      if (!head || inFlight.current) return;
      const token = Symbol("permission-response");
      inFlight.current = token;
      setSubmitting(true);
      setFailed(null);
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
      } catch {
        // Keep the request available for retry; transport details can contain secrets.
        if (inFlight.current === token) setFailed(requestKey);
      } finally {
        if (inFlight.current === token) {
          inFlight.current = null;
          setSubmitting(false);
        }
      }
    },
    [head, requestKey, demoMode, requireWritableClient]
  );
  const dismissPermissionHead = useCallback(() => {
    if (inFlight.current) return;
    if (head)
      setQueue((previous) =>
        dequeuePermissionRequest(previous, head.requestId)
      );
  }, [head]);
  return {
    activePermission: head,
    focusPermission,
    permissionQueueDepth: countPermissionRequests(queue, sessionId),
    permissionSubmitting,
    permissionFailed,
    respondPermission,
    dismissPermissionHead,
    resetPermissions,
    receivePermissionEvent,
    reconcilePermissions,
    reconcileSessionPermissions,
  };
}
