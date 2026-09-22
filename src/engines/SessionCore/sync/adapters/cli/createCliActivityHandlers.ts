/**
 * Streamed activity ingestion for one CLI session: typewriter accumulators
 * for message/thinking deltas, bounded tool-call delta buffers, plan-approval
 * chunks and the authoritative `agent:streaming_complete` replacement.
 */
import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { normalizeChunkRust } from "@src/engines/SessionCore/ingestion/rustBridge";
import {
  createStreamMessageId,
  createStreamThinkingId,
} from "@src/engines/SessionCore/sync/utils/activityIds";
import { createLogger } from "@src/hooks/logger";
import type { ActivityChunk } from "@src/types/session/session";

import type { RawSessionEvent } from "../../types";
import { makeToolCallEvent } from "../shared/eventFactories";
import {
  appendBoundedToolCallArgs,
  makeRoomForToolCallDelta,
  mergeStreamingText,
} from "../shared/streamTextAccumulator";
import {
  buildToolArgsFromParsed,
  parsePartialToolArgs,
} from "../shared/streamingParsers";
import { capStreamContent } from "../shared/subagentTracking";
import { asString, withTurnIntentId } from "./cliEventHandlerHelpers";
import { handlePlanApprovalActivity } from "./cliInteractionEvents";
import { buildCliStreamingEvent } from "./streamingEvent";

const log = createLogger("CliAdapter");
const MAX_FINALIZED_STREAM_IDS = 256;

interface CliActivityHandlerDeps {
  sessionId: string;
  setStreamingMode: (active: boolean) => void;
  /** Register a normalization + EventStore write with the lifecycle barrier. */
  persistObservedEvent: (operation: Promise<unknown>) => void;
  /** A non-user activity chunk arrived; the owner clears its cancelled flag. */
  onActivityObserved: () => void;
}

export interface CliActivityHandlers {
  handleActivity: (
    chunk: ActivityChunk,
    turnIntentId: string | undefined
  ) => void;
  handleStreamingComplete: (raw: RawSessionEvent) => void;
  clearMessageStream: () => void;
  clearThinkingStream: () => void;
  clearToolCallDeltaBuffers: () => void;
}

export function createCliActivityHandlers({
  sessionId,
  setStreamingMode,
  persistObservedEvent,
  onActivityObserved,
}: CliActivityHandlerDeps): CliActivityHandlers {
  // Lightweight local accumulators for the typewriter effect only.
  // Rust's StreamingBuffer is authoritative and replaces these when
  // `agent:streaming_complete` arrives.
  let msgContent = "";
  let msgStreamId = "";
  let msgStartedAt = "";
  let msgTurnIntentId: string | undefined;
  let thinkContent = "";
  let thinkStreamId = "";
  let thinkStartedAt = "";
  let thinkTurnIntentId: string | undefined;
  const finalizedStreamEventIds = new Set<string>();
  const toolCallDeltaBuffers = new Map<
    number,
    { toolCallId?: string; toolName?: string; argsJson: string }
  >();

  function clearMessageStream(): void {
    msgContent = "";
    msgStreamId = "";
    msgStartedAt = "";
    msgTurnIntentId = undefined;
  }

  function clearThinkingStream(): void {
    thinkContent = "";
    thinkStreamId = "";
    thinkStartedAt = "";
    thinkTurnIntentId = undefined;
  }

  function clearToolCallDeltaBuffers(): void {
    toolCallDeltaBuffers.clear();
  }

  function rememberFinalizedStreamEvent(eventId: string): void {
    if (finalizedStreamEventIds.has(eventId)) return;
    while (finalizedStreamEventIds.size >= MAX_FINALIZED_STREAM_IDS) {
      const oldestId = finalizedStreamEventIds.values().next().value;
      if (oldestId === undefined) break;
      finalizedStreamEventIds.delete(oldestId);
    }
    finalizedStreamEventIds.add(eventId);
  }

  function handleToolCallDeltaActivity(
    chunk: ActivityChunk,
    turnIntentId: string | undefined
  ): void {
    setStreamingMode(true);
    const indexValue = chunk.result?.index;
    const index = typeof indexValue === "number" ? indexValue : 0;
    makeRoomForToolCallDelta(toolCallDeltaBuffers, index);
    const existing = toolCallDeltaBuffers.get(index) ?? { argsJson: "" };
    const toolCallId =
      asString(chunk.result?.tool_call_id) ??
      asString(chunk.result?.toolCallId) ??
      existing.toolCallId;
    const toolName =
      asString(chunk.result?.tool_name) ??
      asString(chunk.result?.toolName) ??
      existing.toolName;
    const argumentsDelta =
      asString(chunk.result?.arguments_delta) ??
      asString(chunk.result?.argumentsDelta) ??
      "";
    const nextBuffer = {
      toolCallId,
      toolName,
      argsJson: appendBoundedToolCallArgs(existing.argsJson, argumentsDelta),
    };
    toolCallDeltaBuffers.set(index, nextBuffer);

    if (!nextBuffer.toolCallId) return;

    const parsed = parsePartialToolArgs(nextBuffer.argsJson);
    const args = buildToolArgsFromParsed(parsed);
    persistObservedEvent(
      eventStoreProxy.upsert(
        withTurnIntentId(
          makeToolCallEvent(
            `tool-call-${nextBuffer.toolCallId}`,
            sessionId,
            nextBuffer.toolName,
            nextBuffer.toolCallId,
            args,
            true
          ),
          turnIntentId
        ),
        sessionId
      )
    );
  }

  function handleActivity(
    chunk: ActivityChunk,
    turnIntentId: string | undefined
  ): void {
    if (
      chunk.function === "user_message" &&
      (chunk.action_type === "raw" || chunk.action_type === "raw_event")
    ) {
      return;
    }

    onActivityObserved();

    const isDelta = chunk.result?.is_delta === true;
    const actionType = chunk.action_type;

    if (
      handlePlanApprovalActivity(
        sessionId,
        chunk,
        turnIntentId,
        persistObservedEvent
      )
    ) {
      return;
    }

    const isMessageType =
      actionType === "assistant" ||
      actionType === "assistant_delta" ||
      actionType === "message" ||
      actionType === "message_delta";
    const isThinkingType =
      actionType === "llm_thinking" || actionType === "llm_thinking_delta";

    if (actionType === "tool_call_delta") {
      handleToolCallDeltaActivity(chunk, turnIntentId);
      return;
    }

    if (isDelta && isMessageType) {
      setStreamingMode(true);
      const deltaText =
        (chunk.result?.content as string) ||
        (chunk.result?.observation as string) ||
        "";
      if (!msgStreamId) {
        msgStreamId = createStreamMessageId(sessionId);
        msgStartedAt = chunk.created_at || new Date().toISOString();
      }
      msgTurnIntentId ??= turnIntentId;
      msgContent = capStreamContent(mergeStreamingText(msgContent, deltaText));
      persistObservedEvent(
        eventStoreProxy.upsert(
          withTurnIntentId(
            buildCliStreamingEvent(
              msgStreamId,
              sessionId,
              msgContent,
              "message",
              msgStartedAt
            ),
            msgTurnIntentId
          ),
          sessionId
        )
      );
      return;
    }

    if (isDelta && isThinkingType) {
      setStreamingMode(true);
      const deltaText =
        (chunk.result?.thought as string) ||
        (chunk.result?.content as string) ||
        (chunk.result?.observation as string) ||
        "";
      if (!thinkStreamId) {
        thinkStreamId = createStreamThinkingId(sessionId);
        thinkStartedAt = chunk.created_at || new Date().toISOString();
      }
      thinkTurnIntentId ??= turnIntentId;
      thinkContent = capStreamContent(
        mergeStreamingText(thinkContent, deltaText)
      );
      persistObservedEvent(
        eventStoreProxy.upsert(
          withTurnIntentId(
            buildCliStreamingEvent(
              thinkStreamId,
              sessionId,
              thinkContent,
              "thinking",
              thinkStartedAt
            ),
            thinkTurnIntentId
          ),
          sessionId
        )
      );
      return;
    }

    // Final message/thinking chunks replace any TS typewriter placeholder.
    if (isMessageType || isThinkingType) {
      const tempId = isMessageType ? msgStreamId : thinkStreamId;
      const persistence = normalizeChunkRust(chunk, sessionId).then(
        async (event) => {
          event = withTurnIntentId(event, turnIntentId);
          if (finalizedStreamEventIds.has(event.id)) return;
          if (tempId && tempId !== event.id) {
            if (isMessageType) clearMessageStream();
            else clearThinkingStream();
            rememberFinalizedStreamEvent(event.id);
            await eventStoreProxy.replaceAndRemove(tempId, event, sessionId);
            return;
          }
          await eventStoreProxy.append([event], sessionId);
        }
      );
      persistObservedEvent(persistence);
      return;
    }

    const persistence = normalizeChunkRust(chunk, sessionId).then((event) => {
      event = withTurnIntentId(event, turnIntentId);
      if (actionType === "tool_call") {
        for (const [index, buffer] of toolCallDeltaBuffers.entries()) {
          if (buffer.toolCallId && buffer.toolCallId === event.callId) {
            toolCallDeltaBuffers.delete(index);
          }
        }
        return eventStoreProxy.upsert(event, sessionId);
      }
      return eventStoreProxy.append([event], sessionId);
    });
    persistObservedEvent(persistence);
  }

  function handleStreamingComplete(raw: RawSessionEvent): void {
    const payload = raw.payload as Record<string, unknown> | undefined;
    const completeEvent = payload?.event as SessionEvent | undefined;
    const streamType = payload?.streamType as "message" | "thinking";

    if (!completeEvent) {
      log.warn("[CliAdapter] streaming_complete missing event payload");
      return;
    }
    if (finalizedStreamEventIds.has(completeEvent.id)) return;
    rememberFinalizedStreamEvent(completeEvent.id);

    if (streamType === "message") {
      const tsTempId = msgStreamId;
      const turnIntentId = msgTurnIntentId;
      clearMessageStream();
      const attributedEvent = withTurnIntentId(completeEvent, turnIntentId);
      if (tsTempId && tsTempId !== completeEvent.id) {
        const persistence = eventStoreProxy.replaceAndRemove(
          tsTempId,
          attributedEvent,
          sessionId
        );
        persistObservedEvent(persistence);
      } else {
        const persistence = eventStoreProxy.upsert(attributedEvent, sessionId);
        persistObservedEvent(persistence);
      }
    } else if (streamType === "thinking") {
      const tsTempId = thinkStreamId;
      const turnIntentId = thinkTurnIntentId;
      clearThinkingStream();
      const attributedEvent = withTurnIntentId(completeEvent, turnIntentId);
      if (tsTempId && tsTempId !== completeEvent.id) {
        const persistence = eventStoreProxy.replaceAndRemove(
          tsTempId,
          attributedEvent,
          sessionId
        );
        persistObservedEvent(persistence);
      } else {
        const persistence = eventStoreProxy.upsert(attributedEvent, sessionId);
        persistObservedEvent(persistence);
      }
    } else {
      const persistence = eventStoreProxy.upsert(completeEvent, sessionId);
      persistObservedEvent(persistence);
    }
  }

  return {
    handleActivity,
    handleStreamingComplete,
    clearMessageStream,
    clearThinkingStream,
    clearToolCallDeltaBuffers,
  };
}
