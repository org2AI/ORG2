/** Parser-owned terminal receipts remain in audit history, not provider context. */
import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import { nativeSourceEventId } from "./nativeSourceEventIdentity";

const TERMINAL_DIAGNOSTIC_ARG = "__orgiiNativeTerminalDiagnostic";

export function nativeTerminalDiagnosticTurnId(
  event: SessionEvent
): string | null {
  const provenance = event.args?.[TERMINAL_DIAGNOSTIC_ARG];
  if (
    event.actionType !== "error" ||
    event.functionName !== "error" ||
    event.callId ||
    event.isDelta ||
    (event.source !== "assistant" && event.source !== "system") ||
    event.result?.success !== false ||
    !provenance ||
    typeof provenance !== "object"
  )
    return null;
  const receipt = provenance as Record<string, unknown>;
  return receipt.provider === "codex" &&
    receipt.event === "task_complete" &&
    typeof receipt.providerTurnId === "string" &&
    receipt.providerTurnId.trim().length > 0
    ? receipt.providerTurnId
    : null;
}

/**
 * Exact source identity also recognizes older materialized assistant echoes.
 * Unknown/cross-transcript echoes fail closed: without the original typed
 * receipt in this history they remain ordinary content. Never match text.
 */
export function nativeTerminalDiagnosticSources(
  events: readonly SessionEvent[]
): Set<string> {
  return new Set(
    events.flatMap((event) =>
      nativeTerminalDiagnosticTurnId(event) ? [nativeSourceEventId(event)] : []
    )
  );
}

export function isNativeTerminalDiagnosticOrEcho(
  event: SessionEvent,
  receiptSources: ReadonlySet<string>
): boolean {
  if (nativeTerminalDiagnosticTurnId(event)) return true;
  return (
    event.source === "assistant" &&
    event.actionType === "assistant" &&
    event.functionName === "assistant" &&
    !event.callId &&
    !event.isDelta &&
    receiptSources.has(nativeSourceEventId(event))
  );
}

/** Raw empty-failure proof requires the receipt's own failed native turn. */
export function provenFailedNativeDiagnosticSources(
  suffix: readonly SessionEvent[],
  sessionId: string
): Set<string> {
  const failedTurns = new Set(
    suffix.flatMap((event) =>
      event.sessionId === sessionId &&
      event.actionType === "task_failed" &&
      event.functionName === "task_failed" &&
      typeof event.args?.providerTurnId === "string"
        ? [`${event.sessionId}\0${event.args.providerTurnId}`]
        : []
    )
  );
  return new Set(
    suffix.flatMap((event) => {
      const turnId = nativeTerminalDiagnosticTurnId(event);
      return event.sessionId === sessionId &&
        turnId &&
        failedTurns.has(`${event.sessionId}\0${turnId}`)
        ? [nativeSourceEventId(event)]
        : [];
    })
  );
}
