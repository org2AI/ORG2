import { v5 as uuidv5 } from "uuid";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { isInternalLifecycleEvent } from "@src/engines/SessionCore/ingestion/visibilityFilters";
import { loadAuthoritativeSessionEvents } from "@src/engines/SessionCore/sync/authoritativeSessionEvents";
import { invokeTauri } from "@src/util/platform/tauri/init";
import { isCliSession } from "@src/util/session/sessionDispatch";

import { conversationSenderStampOf } from "./conversationSenderMetadata";
import {
  type LocalConversationTarget,
  NATIVE_CONVERSATION_CLI_TARGETS,
  type NativeConversationCliTarget,
} from "./conversationTypes";

type NativeConversationItem =
  | {
      kind: "message";
      id: string;
      role: "user" | "assistant";
      text: string;
      images: string[];
      createdAt: string;
      /** Stable ORG2 turn identity; provider transports may ignore it. */
      turnId?: string;
    }
  | {
      kind: "tool_call";
      id: string;
      callId: string;
      name: string;
      arguments: string;
      createdAt: string;
    }
  | {
      kind: "tool_result";
      id: string;
      callId: string;
      name: string;
      output: string;
      createdAt: string;
    }
  | {
      kind: "compaction";
      id: string;
      summary: string;
      createdAt: string;
    };

interface NativeMaterializationReceipt {
  nativeSessionId: string;
  itemCount: number;
}

/** OpenAI's strictest current tool-call identifier envelope. */
export const MAX_PORTABLE_TOOL_CALL_ID_LENGTH = 64;
const PORTABLE_TOOL_CALL_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

const PORTABLE_TOOL_CALL_NAMESPACE = "9e7db8a3-94bf-5c58-9416-a244ba6e30d3";

/** Original event identity carried by synthesized/replayed projections. */
export const NATIVE_SOURCE_EVENT_ID_ARG = "__orgiiSourceEventId";

function nativeSourceEventId(event: SessionEvent): string {
  const sourceId = event.args?.[NATIVE_SOURCE_EVENT_ID_ARG];
  return typeof sourceId === "string" && sourceId.length > 0
    ? sourceId
    : event.id;
}

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

/**
 * Provider message schemas have one undifferentiated `user` role and no
 * portable participant/name field. Preserve multi-human Team Chat semantics
 * inside each native user message (never as one transcript prompt) while the
 * canonical SessionEvent keeps the original body and structured sender stamp.
 */
function providerNativeMessageText(event: SessionEvent, text: string): string {
  if (event.source !== "user") return text;
  const sender = conversationSenderStampOf(event);
  if (!sender) return text;
  return `<org2-participant>${JSON.stringify(sender)}</org2-participant>\n${text}`;
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

function portableToolCallId(event: SessionEvent): string {
  const sourceId = event.callId?.trim();
  if (
    sourceId &&
    sourceId.length <= MAX_PORTABLE_TOOL_CALL_ID_LENGTH &&
    PORTABLE_TOOL_CALL_ID_PATTERN.test(sourceId)
  ) {
    return sourceId;
  }

  // Provider-native call IDs are pairing keys, not user-visible content. A
  // stable UUID keeps the call/result relation exact while fitting the
  // strictest supported provider instead of leaking namespaced event IDs.
  const identity = sourceId || event.id;
  return `call_${uuidv5(identity, PORTABLE_TOOL_CALL_NAMESPACE).replace(
    /-/g,
    ""
  )}`;
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

/**
 * Lossless portable conversation plane. It preserves roles and tool pairing;
 * it never renders history into a prompt. Provider-private reasoning and
 * system policy are intentionally outside the portable contract.
 */
export function projectNativeConversationItems(
  events: readonly SessionEvent[]
): NativeConversationItem[] {
  const items: NativeConversationItem[] = [];
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
  for (const event of events) {
    if (
      event.actionType === "context_compacted" ||
      event.functionName === "context_compacted"
    ) {
      const summary = eventText(event).trim();
      // Some providers emit window/checkpoint markers without a transferable
      // summary. They remain useful ORG2 timeline annotations, but projecting
      // one as a native compact with an empty replacement history destroys the
      // target provider's effective context. In that case rebuild the complete
      // structured role/tool list and let the target manage its own context.
      if (!summary) continue;
      items.push({
        kind: "compaction",
        id: nativeSourceEventId(event),
        summary,
        createdAt: event.createdAt,
      });
      continue;
    }
    if (
      event.isDelta ||
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
        items.push({
          kind: "tool_result",
          id: `${nativeSourceEventId(event)}:result`,
          callId,
          name,
          output: eventText(event),
          createdAt: event.createdAt,
        });
      }
      continue;
    }
    if (event.source !== "user" && event.source !== "assistant") continue;
    const text = providerNativeMessageText(event, eventText(event));
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
  return items;
}

function sourceEventIdOfNativeItem(item: NativeConversationItem): string {
  return item.id.replace(/:(?:call|result)$/, "");
}

/**
 * Native CLIs can be killed before their newest fork is flushed. In that
 * case the native reader deliberately falls back to the previous readable
 * fork, while EventStore still holds the accepted user row and any durable
 * partial output already streamed by the interrupted turn. Extend the native
 * semantic prefix with exactly that portable suffix instead of blanking it
 * during reconcile. Divergent histories fail closed and keep native truth.
 */
export function mergeInterruptedConversationProjection(
  nativeEvents: readonly SessionEvent[],
  projectedEvents: readonly SessionEvent[]
): SessionEvent[] {
  const nativeItems = projectNativeConversationItems(nativeEvents);
  const projectedItems = projectNativeConversationItems(projectedEvents);
  if (
    nativeItems.length >= projectedItems.length ||
    !nativeConversationItemsArePrefix(nativeItems, projectedItems)
  ) {
    return [...nativeEvents];
  }

  const suffixSourceIds = new Set(
    projectedItems.slice(nativeItems.length).map(sourceEventIdOfNativeItem)
  );
  const nativeEventIds = new Set(nativeEvents.map((event) => event.id));
  const suffix = projectedEvents.filter(
    (event) =>
      suffixSourceIds.has(nativeSourceEventId(event)) &&
      !nativeEventIds.has(event.id)
  );
  return suffix.length > 0 ? [...nativeEvents, ...suffix] : [...nativeEvents];
}

function semanticItem(item: NativeConversationItem): unknown {
  switch (item.kind) {
    case "message":
      return [item.kind, item.role, item.text, item.images];
    case "tool_call":
      return [
        item.kind,
        item.callId,
        item.name,
        canonicalJson(JSON.parse(item.arguments) as unknown),
      ];
    case "tool_result":
      return [item.kind, item.callId, item.name, item.output];
    case "compaction":
      return [item.kind, item.summary];
  }
}

/**
 * Provider-neutral semantic identity for one canonical event. Unlike event
 * ids, this survives a native provider parser that exposes only positional
 * ids after materialization. Callers must still match occurrences one-to-one:
 * repeated equal messages in different turns are valid conversation events.
 */
export function nativeConversationEventSemanticKey(
  event: SessionEvent
): string | null {
  const items = projectNativeConversationItems([event]);
  return items.length > 0
    ? JSON.stringify(items.map((item) => semanticItem(item)))
    : null;
}

function nativeItemShape(item: NativeConversationItem | undefined): string {
  if (!item) return "missing";
  switch (item.kind) {
    case "message":
      return `message:${item.role}:text=${item.text.length}:images=${item.images.length}`;
    case "tool_call":
      return `tool_call:${item.name}:call=${item.callId}:arguments=${item.arguments.length}`;
    case "tool_result":
      return `tool_result:${item.name}:call=${item.callId}:output=${item.output.length}`;
    case "compaction":
      return `compaction:summary=${item.summary.length}`;
  }
}

function nativeConversationMismatch(
  expected: readonly NativeConversationItem[],
  actual: readonly NativeConversationItem[]
): string {
  const sharedLength = Math.min(expected.length, actual.length);
  let firstMismatch = sharedLength;
  for (let index = 0; index < sharedLength; index += 1) {
    if (
      JSON.stringify(semanticItem(expected[index])) !==
      JSON.stringify(semanticItem(actual[index]))
    ) {
      firstMismatch = index;
      break;
    }
  }
  return [
    `expected=${expected.length}`,
    `actual=${actual.length}`,
    `firstMismatch=${firstMismatch}`,
    `expectedShape=${nativeItemShape(expected[firstMismatch])}`,
    `actualShape=${nativeItemShape(actual[firstMismatch])}`,
  ].join(" ");
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalJson(item)])
    );
  }
  return value;
}

export function nativeConversationItemsEqual(
  left: readonly NativeConversationItem[],
  right: readonly NativeConversationItem[]
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (item, index) =>
        JSON.stringify(semanticItem(item)) ===
        JSON.stringify(semanticItem(right[index]))
    )
  );
}

export function nativeConversationItemsArePrefix(
  prefix: readonly NativeConversationItem[],
  complete: readonly NativeConversationItem[]
): boolean {
  return (
    prefix.length <= complete.length &&
    prefix.every(
      (item, index) =>
        JSON.stringify(semanticItem(item)) ===
        JSON.stringify(semanticItem(complete[index]))
    )
  );
}

export function supportsNativeConversationTarget(
  target: Pick<LocalConversationTarget, "cliAgentType">
): boolean {
  return (
    !target.cliAgentType ||
    NATIVE_CONVERSATION_CLI_TARGETS.includes(
      target.cliAgentType as NativeConversationCliTarget
    )
  );
}

export async function materializeNativeConversation(params: {
  sessionId: string;
  timeline: readonly SessionEvent[];
}): Promise<{ events: SessionEvent[]; receipt: NativeMaterializationReceipt }> {
  const items = projectNativeConversationItems(params.timeline);
  if (params.timeline.length > 0 && items.length === 0) {
    throw new Error(
      "conversation has no portable native role/tool transcript to materialize"
    );
  }
  // With no history there is nothing to migrate. Leave the fresh target
  // unbound so its normal first send creates the provider-native session.
  if (items.length === 0) {
    return {
      events: [],
      receipt: { nativeSessionId: "", itemCount: 0 },
    };
  }
  const receipt = await invokeTauri<NativeMaterializationReceipt>(
    "materialize_native_conversation",
    { sessionId: params.sessionId, items }
  );
  try {
    if (receipt.itemCount !== items.length) {
      throw new Error(
        `native materializer wrote ${receipt.itemCount} of ${items.length} items`
      );
    }
    const { events } = await loadAuthoritativeSessionEvents(params.sessionId);
    const roundTripped = projectNativeConversationItems(events);
    if (!nativeConversationItemsEqual(items, roundTripped)) {
      throw new Error(
        `native transcript round-trip verification failed; the target session was not started (${nativeConversationMismatch(items, roundTripped)})`
      );
    }
    if (isCliSession(params.sessionId) && receipt.nativeSessionId) {
      await invokeTauri("commit_native_conversation_materialization", {
        sessionId: params.sessionId,
        nativeSessionId: receipt.nativeSessionId,
      });
    }
    return { events, receipt };
  } catch (error) {
    if (isCliSession(params.sessionId)) {
      await invokeTauri("discard_native_conversation_materialization", {
        sessionId: params.sessionId,
        nativeSessionId: receipt.nativeSessionId,
      }).catch(() => undefined);
    }
    throw error;
  }
}

/**
 * Bring an existing execution episode up to the canonical transcript before
 * native resume. The complete structured role/tool history is written into
 * the target provider's own transcript format; no delta is rendered as a
 * user prompt. Only strict semantic-prefix growth is allowed, so a branch or
 * rewrite rolls to a new episode instead of mutating unrelated history.
 */
export async function synchronizeNativeConversation(params: {
  sessionId: string;
  timeline: readonly SessionEvent[];
  existingEvents: readonly SessionEvent[];
}): Promise<{ events: SessionEvent[]; receipt: NativeMaterializationReceipt }> {
  const complete = projectNativeConversationItems(params.timeline);
  const existing = projectNativeConversationItems(params.existingEvents);
  if (!nativeConversationItemsArePrefix(existing, complete)) {
    throw new Error(
      "native transcript is not a semantic prefix of the canonical conversation"
    );
  }
  if (existing.length === complete.length) {
    return {
      events: [...params.existingEvents],
      receipt: {
        nativeSessionId: params.sessionId,
        itemCount: complete.length,
      },
    };
  }
  const receipt = await invokeTauri<NativeMaterializationReceipt>(
    "synchronize_native_conversation",
    {
      sessionId: params.sessionId,
      completeItems: complete,
      prefixItemCount: existing.length,
    }
  );
  if (receipt.itemCount !== complete.length) {
    throw new Error(
      `native synchronizer wrote ${receipt.itemCount} of ${complete.length} items`
    );
  }
  const { events } = await loadAuthoritativeSessionEvents(params.sessionId);
  if (
    !nativeConversationItemsEqual(
      complete,
      projectNativeConversationItems(events)
    )
  ) {
    throw new Error(
      `native transcript synchronization round-trip verification failed (${nativeConversationMismatch(complete, projectNativeConversationItems(events))})`
    );
  }
  if (isCliSession(params.sessionId) && receipt.nativeSessionId) {
    await invokeTauri("commit_native_conversation_materialization", {
      sessionId: params.sessionId,
      nativeSessionId: receipt.nativeSessionId,
    });
  }
  return { events, receipt };
}
