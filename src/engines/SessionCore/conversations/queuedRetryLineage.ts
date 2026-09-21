/** Durable identity links for explicit retries of a definitively empty failed turn.
 * Audit rows remain untouched. Only these links change the effective context.
 */
import { v5 as uuidv5 } from "uuid";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { isInternalLifecycleEvent } from "@src/engines/SessionCore/ingestion/visibilityFilters";

import { conversationTurnIdOf } from "./localConversationTurnIdentity";
import { nativeSourceEventId } from "./nativeSourceEventIdentity";
import {
  isNativeTerminalDiagnosticOrEcho,
  provenFailedNativeDiagnosticSources,
} from "./nativeTerminalDiagnostic";
import { retryAuditBoundary } from "./retryAuditBoundary";

export const QUEUED_RETRY_LINEAGE_ACTION = "queued_retry_lineage";
export const MAX_QUEUED_RETRY_ATTEMPTS = 64;
const PAYLOAD_NAMESPACE = "119f0c36-87dc-5e58-8d83-4869aa7bda22";

export interface RetryAttempt {
  turnIntentId: string;
  sessionId: string;
  sourceEventIds: string[];
}
export interface QueuedRetryLineage {
  version: 1;
  queueMessageId: string;
  superseded: RetryAttempt[];
  failed?: RetryAttempt & { payloadId: string };
}
export interface RetryMessage {
  id: string;
  turnIntentId: string;
  content: string;
  displayContent: string;
  imageDataUrls?: string[];
}

export function retryLineageEventId(queueMessageId: string): string {
  return `queued-retry-lineage:${queueMessageId}:`;
}
function payloadId(message: RetryMessage): string {
  // Equality is checked only WITHIN an explicit, stable queue identity. This
  // detects edits; it never deduplicates independent same-text submissions.
  return uuidv5(
    JSON.stringify([
      message.content,
      message.displayContent,
      message.imageDataUrls ?? [],
    ]),
    PAYLOAD_NAMESPACE
  );
}
function isAttempt(value: unknown): value is RetryAttempt {
  if (!value || typeof value !== "object") return false;
  const attempt = value as RetryAttempt;
  return (
    typeof attempt.sessionId === "string" &&
    attempt.sessionId.length > 0 &&
    typeof attempt.turnIntentId === "string" &&
    attempt.turnIntentId.length > 0 &&
    Array.isArray(attempt.sourceEventIds) &&
    attempt.sourceEventIds.length <= 16 &&
    attempt.sourceEventIds.every(
      (id) => typeof id === "string" && id.startsWith("orgii_evt_")
    )
  );
}
export function retryLineageOf(event: SessionEvent): QueuedRetryLineage | null {
  if (event.actionType !== QUEUED_RETRY_LINEAGE_ACTION) return null;
  const value = event.result?.retryLineage as QueuedRetryLineage | undefined;
  if (
    !value ||
    value.version !== 1 ||
    typeof value.queueMessageId !== "string" ||
    event.id !== retryLineageEventId(value.queueMessageId) ||
    !Array.isArray(value.superseded) ||
    value.superseded.length > MAX_QUEUED_RETRY_ATTEMPTS ||
    !value.superseded.every(isAttempt) ||
    (value.failed !== undefined &&
      (!isAttempt(value.failed) || typeof value.failed.payloadId !== "string"))
  )
    return null;
  return value;
}
export function retryLineageEvents(
  events: readonly SessionEvent[]
): SessionEvent[] {
  return events.filter((event) => retryLineageOf(event) !== null);
}
export function retryLineageEvent(
  sessionId: string,
  lineage: QueuedRetryLineage
): SessionEvent {
  return {
    id: retryLineageEventId(lineage.queueMessageId),
    chunk_id: retryLineageEventId(lineage.queueMessageId),
    sessionId,
    createdAt: new Date().toISOString(),
    functionName: "system",
    actionType: QUEUED_RETRY_LINEAGE_ACTION,
    uiCanonical: "",
    args: {},
    result: { retryLineage: lineage },
    source: "system",
    displayText: "",
    displayStatus: "completed",
    displayVariant: "session",
    activityStatus: "processed",
  } as SessionEvent;
}
export function retryLineageForMessage(
  events: readonly SessionEvent[],
  message: RetryMessage
): QueuedRetryLineage {
  return (
    events
      .map(retryLineageOf)
      .find((value) => value?.queueMessageId === message.id) ?? {
      version: 1,
      queueMessageId: message.id,
      superseded: [],
    }
  );
}
export function beginQueuedRetry(
  lineage: QueuedRetryLineage,
  message: RetryMessage
): QueuedRetryLineage {
  if (
    !lineage.failed ||
    lineage.queueMessageId !== message.id ||
    lineage.failed.turnIntentId === message.turnIntentId
  )
    return lineage;
  const { failed, ...previous } = lineage;
  if (failed.payloadId !== payloadId(message)) return previous;
  if (lineage.superseded.length >= MAX_QUEUED_RETRY_ATTEMPTS) {
    throw new Error(
      "Retry attempt limit reached; start a new message to preserve this queue's history"
    );
  }
  return {
    ...previous,
    superseded: [
      ...lineage.superseded,
      {
        turnIntentId: failed.turnIntentId,
        sessionId: failed.sessionId,
        sourceEventIds: failed.sourceEventIds,
      },
    ],
  };
}
export function recordEmptyFailedAttempt(
  lineage: QueuedRetryLineage,
  message: RetryMessage,
  events: readonly SessionEvent[]
): QueuedRetryLineage {
  let anchorIndex = -1;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (
      events[index].source === "user" &&
      conversationTurnIdOf(events[index]) === message.turnIntentId
    ) {
      anchorIndex = index;
      break;
    }
  }
  if (anchorIndex < 0) return lineage; // no proven native prompt to supersede
  const anchor = events[anchorIndex];
  const suffix = events.slice(anchorIndex + 1);
  const failedDiagnosticSources = provenFailedNativeDiagnosticSources(
    suffix,
    anchor.sessionId
  );
  if (
    suffix.some(
      (event) =>
        !isInternalLifecycleEvent(event) &&
        !(
          failedDiagnosticSources.has(nativeSourceEventId(event)) &&
          isNativeTerminalDiagnosticOrEcho(event, failedDiagnosticSources)
        ) &&
        !(event.functionName === "system" && event.displayStatus === "failed")
    )
  ) {
    // The portable tail omits private reasoning. Check raw native events as
    // well, so tool/partial/reasoning output never acquires empty-failure proof.
    throw new Error("Failed attempt has an unresolved native output suffix");
  }
  const sourceEventIds = [
    ...new Set(
      events
        .filter(
          (event) =>
            event.source === "user" &&
            event.sessionId === anchor.sessionId &&
            conversationTurnIdOf(event) === message.turnIntentId
        )
        .map(nativeSourceEventId)
    ),
  ];
  if (sourceEventIds.length > 16)
    throw new Error("Ambiguous retry attempt identity");
  return {
    ...lineage,
    failed: {
      turnIntentId: message.turnIntentId,
      sessionId: anchor.sessionId,
      sourceEventIds,
      payloadId: payloadId(message),
    },
  };
}

export function effectiveQueuedRetryEvents(
  events: readonly SessionEvent[],
  lineageEvents: readonly SessionEvent[] = events,
  preserveAuditBoundaries = false
): SessionEvent[] {
  const links = lineageEvents.flatMap((event) =>
    (retryLineageOf(event)?.superseded ?? []).map((attempt) => ({
      ...attempt,
      rootSessionId: event.sessionId,
    }))
  );
  if (links.length === 0) return events as SessionEvent[];
  const owners = new Set(
    links.flatMap((attempt) => [
      `${attempt.sessionId}\0${attempt.turnIntentId}`,
      `${attempt.rootSessionId}\0${attempt.turnIntentId}`,
    ])
  );
  const sources = new Set(links.flatMap((attempt) => attempt.sourceEventIds));
  const isSuperseded = (event: SessionEvent) =>
    event.source === "user" &&
    (owners.has(`${event.sessionId}\0${conversationTurnIdOf(event) ?? ""}`) ||
      sources.has(nativeSourceEventId(event)));
  return preserveAuditBoundaries
    ? events.map((event) =>
        isSuperseded(event) ? retryAuditBoundary(event) : event
      )
    : events.filter((event) => !isSuperseded(event));
}

/** Chat retains the failed attempt's position while context omits its prompt. */
export function projectQueuedRetryChatEvents(
  events: readonly SessionEvent[]
): SessionEvent[] {
  return effectiveQueuedRetryEvents(events, events, true);
}
