import { conversationTurnIdOf } from "@src/engines/SessionCore/conversations/localConversationTurnIdentity";
import {
  NATIVE_SOURCE_EVENT_ID_ARG,
  nativeSourceEventId,
} from "@src/engines/SessionCore/conversations/nativeSourceEventIdentity";
import {
  nativeTerminalDiagnosticTurnId,
  nativeTurnFailureDiagnostic,
} from "@src/engines/SessionCore/conversations/nativeTerminalDiagnostic";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import type { CloudConversationEvent } from "../org2CloudConversationEventsClient";

/**
 * Older publishers invented a second error identity for an existing native
 * receipt. Restore that identity only from a unique, terminally failed native
 * turn and the exact legacy publication envelope. This read projection never
 * changes either audit source, and never infers identity from message text.
 */
export function reconcileLegacyTerminalIdentity(
  base: readonly SessionEvent[],
  rows: readonly CloudConversationEvent[]
): readonly CloudConversationEvent[] {
  const legacyRows = rows.filter((row) => {
    const event = row.event;
    return (
      event.id === `convturn-error-${row.turnId}` &&
      event.sessionId === "conversation" &&
      event.source === "system" &&
      event.actionType === "error" &&
      event.functionName === "error" &&
      !event.callId &&
      !event.isDelta &&
      event.result?.success === false &&
      event.result.turnIntentId === row.turnId &&
      event.args?.conversationTurnId === row.turnId &&
      !event.args[NATIVE_SOURCE_EVENT_ID_ARG]
    );
  });
  if (legacyRows.length === 0) return rows;
  const wanted = new Set(legacyRows.map((row) => row.turnId));
  const receipts = new Map<string, SessionEvent | null>();
  const segments = new Map<string, SessionEvent[]>();
  const finish = (segment: SessionEvent[]) => {
    const intent = conversationTurnIdOf(segment[0]);
    if (!intent || !wanted.has(intent)) return;
    const terminalIds = new Set(
      segment
        .filter((event) => nativeTerminalDiagnosticTurnId(event))
        .map(nativeSourceEventId)
    );
    const receipt =
      terminalIds.size === 1
        ? nativeTurnFailureDiagnostic(segment, intent)
        : undefined;
    // Multiple attempts or incomplete proof are ambiguous, even if their
    // human-readable errors happen to match.
    if (receipts.has(intent)) {
      const previous = receipts.get(intent);
      if (
        !previous ||
        !receipt ||
        nativeSourceEventId(previous) !== nativeSourceEventId(receipt)
      ) {
        receipts.set(intent, null);
      }
    } else {
      receipts.set(intent, receipt ?? null);
    }
  };
  for (const event of base) {
    const segment = segments.get(event.sessionId);
    if (event.source === "user") {
      if (segment) finish(segment);
      const intent = conversationTurnIdOf(event);
      if (intent && wanted.has(intent)) {
        segments.set(event.sessionId, [event]);
      } else {
        segments.delete(event.sessionId);
      }
    } else if (segment) {
      segment.push(event);
    }
  }
  for (const segment of segments.values()) finish(segment);
  const eligible = new Set(legacyRows);
  return rows.map((row) => {
    if (!eligible.has(row)) return row;
    const receipt = receipts.get(row.turnId);
    // Equality is a final consistency check after proving turn identity; it
    // cannot merge separate errors or replace a different dispatch failure.
    if (!receipt || receipt.result.error !== row.event.result.error) return row;
    return {
      ...row,
      event: {
        ...row.event,
        args: {
          ...row.event.args,
          [NATIVE_SOURCE_EVENT_ID_ARG]: nativeSourceEventId(receipt),
        },
      },
    };
  });
}
