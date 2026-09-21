/**
 * Projection of the canonical SessionEvent log into provider-native
 * conversation items: role messages, closed tool call/result pairs and the
 * latest context summary, with ORG2-private rows filtered out.
 */
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { isInternalLifecycleEvent } from "@src/engines/SessionCore/ingestion/visibilityFilters";

import { conversationSenderStampOf } from "./conversationSenderMetadata";
import type {
  NativeConversationFidelity,
  NativeConversationItem,
} from "./nativeConversationItemTypes";
import {
  nativeSourceEventId,
  portableToolCallId,
} from "./nativeSourceEventIdentity";
import {
  isNativeTerminalDiagnosticOrEcho,
  nativeTerminalDiagnosticSources,
} from "./nativeTerminalDiagnostic";
import { effectiveQueuedRetryEvents } from "./queuedRetryLineage";

function nativeConversationTurnId(event: SessionEvent): string | undefined {
  const resultTurnId = (event.result as Record<string, unknown> | undefined)
    ?.turnIntentId;
  if (typeof resultTurnId === "string" && resultTurnId.length > 0) {
    return resultTurnId;
  }
  const argTurnId = event.args?.conversationTurnId;
  return typeof argTurnId === "string" && argTurnId.length > 0
    ? argTurnId
    : undefined;
}

function eventText(event: SessionEvent): string {
  const result = event.result as Record<string, unknown> | undefined;
  const message = result?.message as Record<string, unknown> | undefined;
  for (const candidate of [
    message?.content,
    result?.content,
    result?.observation,
    result?.output,
    event.displayText,
  ]) {
    if (typeof candidate === "string") return candidate;
  }
  return "";
}

function eventImages(event: SessionEvent): string[] {
  const images = (event.result as Record<string, unknown> | undefined)?.images;
  if (!Array.isArray(images)) return [];
  return images.filter(
    (image): image is string => typeof image === "string" && image.length > 0
  );
}

function isUndeliveredUserEvent(event: SessionEvent): boolean {
  if (event.source !== "user") return false;
  const deliveryStatus = (event.result as Record<string, unknown> | undefined)
    ?.deliveryStatus;
  return (
    event.displayStatus === "pending" ||
    event.displayStatus === "failed" ||
    deliveryStatus === "pending" ||
    deliveryStatus === "failed"
  );
}

function transferableToolArgs(event: SessionEvent): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(event.args ?? {}).filter(
      ([key]) =>
        key !== "conversationTurnId" &&
        key !== "conversationSender" &&
        !key.startsWith("__orgii")
    )
  );
}

function isPrivateProviderEvent(event: SessionEvent): boolean {
  const action = event.actionType.toLowerCase();
  const fn = event.functionName.toLowerCase();
  return (
    action.includes("thinking") ||
    action.includes("reasoning") ||
    fn.includes("thinking") ||
    fn.includes("reasoning")
  );
}

function isToolEvent(event: SessionEvent): boolean {
  return (
    event.actionType === "tool_call" ||
    Boolean(event.callId && event.functionName)
  );
}

function hasToolResult(event: SessionEvent): boolean {
  const resultStatus = event.result?.status;
  return (
    event.displayStatus !== "running" &&
    event.displayStatus !== "pending" &&
    resultStatus !== "running" &&
    resultStatus !== "pending"
  );
}

function toolResultFlags(event: SessionEvent): {
  isError: boolean;
  interrupted: boolean;
} {
  const result = event.result as Record<string, unknown> | undefined;
  const status =
    typeof result?.status === "string" ? result.status.toLowerCase() : "";
  const displayStatus = event.displayStatus?.toLowerCase() ?? "";
  const interrupted =
    result?.interrupted === true ||
    status === "interrupted" ||
    displayStatus === "interrupted" ||
    displayStatus === "cancelled";
  return {
    interrupted,
    isError:
      interrupted ||
      result?.isError === true ||
      result?.is_error === true ||
      ["error", "failed", "cancelled"].includes(status) ||
      ["error", "failed", "cancelled"].includes(displayStatus),
  };
}

/**
 * Provider-native conversation content. It preserves roles and tool pairing;
 * it never renders history into a prompt. Provider-private reasoning, system
 * policy and unsupported participant metadata are outside the item contract;
 * callers that need the fidelity result use `projectNativeConversation`.
 */
export function projectNativeConversationItems(
  events: readonly SessionEvent[]
): NativeConversationItem[] {
  const items: NativeConversationItem[] = [];
  const diagnosticSources = nativeTerminalDiagnosticSources(events);
  const persistedUserMessageIds = new Set(
    events.flatMap((event) => {
      if (event.functionName !== "user_message") return [];
      const messageId = (event.result as Record<string, unknown> | undefined)
        ?.messageId;
      return typeof messageId === "string" && messageId.length > 0
        ? [messageId]
        : [];
    })
  );
  for (const event of effectiveQueuedRetryEvents(events)) {
    if (
      event.actionType === "context_compacted" ||
      event.functionName === "context_compacted"
    ) {
      const summary = eventText(event);
      if (summary.trim().length > 0) {
        // The full canonical log remains intact for ORG2 history, but the
        // provider's effective context is its latest native summary plus the
        // structured suffix. Rebuild that message list instead of feeding the
        // superseded prefix back until every runtime compacts again.
        items.length = 0;
        items.push({
          kind: "context_summary",
          id: nativeSourceEventId(event),
          summary,
          createdAt: event.createdAt,
        });
      }
      continue;
    }
    if (
      event.isDelta ||
      isNativeTerminalDiagnosticOrEcho(event, diagnosticSources) ||
      isInternalLifecycleEvent(event) ||
      isPrivateProviderEvent(event) ||
      isUndeliveredUserEvent(event)
    ) {
      continue;
    }
    // Rust Agent persistence emits a low-level `user_input` acceptance row
    // followed by the canonical `user_message` whose result.messageId points
    // back to it. The UI collapses that pair to one bubble; the provider
    // projection must do the same or every rebuilt runtime sees the prompt
    // twice. A standalone imported `user_input` remains portable.
    if (
      event.source === "user" &&
      event.functionName === "user_input" &&
      persistedUserMessageIds.has(event.id)
    ) {
      continue;
    }
    if (isToolEvent(event)) {
      // An interrupted provider turn may leave an unresolved tool_use /
      // function_call in its native store. A call without a result is not a
      // portable conversation boundary: replaying it into another provider
      // either violates that provider's message grammar or makes the next
      // user message look like the missing tool result. Keep the user row,
      // completed narration and every closed call/result pair, but drop only
      // this unfinished tail. Standalone tool_result rows are likewise not a
      // pair; normal ingestion merges them into their tool_call first.
      if (event.actionType === "tool_result" || !hasToolResult(event)) {
        continue;
      }
      const callId = portableToolCallId(event);
      const name = event.functionName.trim();
      if (!name) {
        throw new Error(`native transcript tool event ${event.id} has no name`);
      }
      items.push({
        kind: "tool_call",
        id: `${nativeSourceEventId(event)}:call`,
        callId,
        name,
        arguments: JSON.stringify(transferableToolArgs(event)),
        createdAt: event.createdAt,
      });
      if (hasToolResult(event)) {
        const { isError, interrupted } = toolResultFlags(event);
        items.push({
          kind: "tool_result",
          id: `${nativeSourceEventId(event)}:result`,
          callId,
          name,
          output: eventText(event),
          isError,
          interrupted,
          createdAt: event.createdAt,
        });
      }
      continue;
    }
    if (event.source !== "user" && event.source !== "assistant") continue;
    // A provider without structured participant metadata receives the exact
    // human body. Never smuggle ORG2 markup into visible native user text;
    // `projectNativeConversation` reports that authorship loss explicitly.
    const text = eventText(event);
    const images = eventImages(event);
    if (!text && images.length === 0) continue;
    const turnId =
      event.source === "user" ? nativeConversationTurnId(event) : undefined;
    items.push({
      kind: "message",
      id: nativeSourceEventId(event),
      role: event.source,
      text,
      images,
      createdAt: event.createdAt,
      ...(turnId ? { turnId } : {}),
    });
  }
  // The canonical timeline normally collapses copied source rows while it
  // stitches native, plane and discussion segments. Old persisted plane rows
  // can already carry the same globally scoped identity, though, and an
  // execution overlay can reintroduce that copy after the stitch. Native item
  // identity is the final transport boundary: two items with the same durable
  // id are the same message/call/result, so keep the first instead of sending
  // an invalid duplicate transcript to the provider writer.
  const seenItemIds = new Set<string>();
  return items.filter((item) => {
    if (seenItemIds.has(item.id)) return false;
    seenItemIds.add(item.id);
    return true;
  });
}

export function projectNativeConversation(events: readonly SessionEvent[]): {
  items: NativeConversationItem[];
  fidelity: NativeConversationFidelity;
} {
  const items = projectNativeConversationItems(events);
  const projectedUserIds = new Set(
    items.flatMap((item) =>
      item.kind === "message" && item.role === "user" ? [item.id] : []
    )
  );
  const losesAuthorship = events.some(
    (event) =>
      event.source === "user" &&
      projectedUserIds.has(nativeSourceEventId(event)) &&
      conversationSenderStampOf(event) !== null
  );
  return {
    items,
    fidelity: losesAuthorship
      ? { level: "lossy", omitted: ["participant_authorship"] }
      : { level: "exact", omitted: [] },
  };
}
