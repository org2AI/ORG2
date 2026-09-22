/** Effective-chat boundary for a proven superseded empty retry attempt.
 * The native/store prompt remains raw; only snapshot/chat projections use this
 * marker, so retained diagnostics cannot be reassigned to the preceding turn.
 */
import type { SessionEvent } from "@src/engines/SessionCore/core/types";

export const RETRY_AUDIT_BOUNDARY_ACTION = "queued_retry_audit_boundary";

export function retryAuditBoundary(event: SessionEvent): SessionEvent {
  return {
    ...event,
    source: "system",
    functionName: "system",
    actionType: RETRY_AUDIT_BOUNDARY_ACTION,
    uiCanonical: "",
    extracted: undefined,
    payloadRefs: [],
    displayText: "",
    displayVariant: "session",
    displayStatus: "completed",
    args: event.args?.__orgiiSourceEventId
      ? { __orgiiSourceEventId: event.args.__orgiiSourceEventId }
      : {},
    result: { retryAuditBoundary: { version: 1, sourceEventId: event.id } },
  };
}

export function isRetryAuditBoundary(event: SessionEvent): boolean {
  const boundary = event.result?.retryAuditBoundary;
  if (!boundary || typeof boundary !== "object") return false;
  const value = boundary as Record<string, unknown>;
  return (
    event.source === "system" &&
    event.functionName === "system" &&
    event.actionType === RETRY_AUDIT_BOUNDARY_ACTION &&
    value.version === 1 &&
    value.sourceEventId === event.id
  );
}
