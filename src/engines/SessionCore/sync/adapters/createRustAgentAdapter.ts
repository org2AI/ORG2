/**
 * Rust Agent Adapter Factory
 *
 * Creates a SessionAdapter for Rust-based agents (OS Agent, SDE Agent, Wingman Agent etc).
 * Both agents share the same core architecture:
 * - Load history via Tauri command
 * - Handle real-time events via dispatchAgentEvent
 * - Stop via cancel command
 *
 * Differences are parameterized via config:
 * - Tauri command names
 * - Event handler feature flags
 * - Text transforms
 */
import { cancelSession, loadMessages } from "@src/api/tauri/agent";
import type { CancelReason } from "@src/api/tauri/agent";
import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import {
  mergeToolResults,
  persistedMessageToSessionEvent,
} from "@src/engines/SessionCore/ingestion/agentMessageAdapters";
import type { PersistedMessage } from "@src/engines/SessionCore/ingestion/agentMessageAdapters";
import { retryInvokeTauri } from "@src/util/platform/tauri/retryInvoke";

import type {
  AdapterSendInput,
  EventHandlerCallbacks,
  PostLoadResult,
  SessionAdapter,
  SessionEventHandler,
} from "../types";
import { createRustAgentEventHandler } from "./rustAgent/createRustAgentEventHandler";
import type { RustAgentFeatures } from "./rustAgent/eventHandlers";
import {
  clearSessionStreamingStopped,
  markSessionStreamingStopped,
} from "./rustAgent/eventHandlers/streamHelpers";
import { loadRustAgentPostLoadResult } from "./rustAgent/postLoad";
import {
  type StreamingEdgeController,
  createStreamingEdgeController,
} from "./rustAgent/streamingEdgeController";
import { backfillSubagentLinks } from "./rustAgent/subagentLinkBackfill";
import {
  applyLlmUsageToEvents,
  applyToolUsageToEvents,
  loadUsageTelemetry,
} from "./rustAgent/toolUsageCache";
import { buildRustAgentSendMessageArgs } from "./rustAgentSendPayload";

export {
  type StreamingEdgeController,
  createStreamingEdgeController,
} from "./rustAgent/streamingEdgeController";
export { isRustAgentTurnNeutralEvent } from "./rustAgent/turnEventClassification";
export { getLatestContextUsageSnapshot } from "./rustAgent/usageProjection";

// ============================================================================
// Configuration
// ============================================================================

export interface RustAgentConfig {
  /** Session category identifier (e.g., "os", "agent") */
  category: string;

  /** Async function to load persisted messages */
  loadMessages: (sessionId: string) => Promise<PersistedMessage[]>;

  /** Async function to cancel/stop the session */
  cancel: (sessionId: string, reason: CancelReason) => Promise<void>;

  /** Tauri command to fetch token usage (optional, SDE only) */
  tokenUsageCommand?: string;

  /** Transform user message display text (OS strips terminal blocks) */
  transformUserText?: (content: string) => string;

  /** Event handler feature flags */
  features: RustAgentFeatures;
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a SessionAdapter for a Rust-based agent.
 */
export function createRustAgentAdapter(
  config: RustAgentConfig
): SessionAdapter {
  const {
    category,
    loadMessages,
    cancel,
    tokenUsageCommand,
    transformUserText,
    features,
  } = config;
  const streamingControllers = new Map<string, StreamingEdgeController>();

  const getStreamingController = (sessionId: string) => {
    const existing = streamingControllers.get(sessionId);
    if (existing) return existing;
    const created = createStreamingEdgeController((value) => {
      void eventStoreProxy.setStreaming(value, sessionId);
    });
    streamingControllers.set(sessionId, created);
    return created;
  };

  // Native replay must read model-authored arguments, not the display view's
  // subagent links, usage annotations, or transformed user copy.
  const loadAuthoritativeHistory = async (
    sessionId: string,
    signal: AbortSignal
  ): Promise<SessionEvent[]> => {
    const messages = await loadMessages(sessionId);
    if (signal.aborted || !messages?.length) return [];
    // Match Rust load_native_history's complete effective frame.
    // The boundary is appended after its retained tail, so simply clearing
    // projected items on encountering the marker loses that entire tail.
    const boundary = messages.reduce<PersistedMessage | undefined>(
      (latest, message) =>
        message.compactFromSequence != null &&
        (!latest || message.sequence > latest.sequence)
          ? message
          : latest,
      undefined
    );
    const effectiveMessages = boundary
      ? [
          boundary,
          ...messages.filter(
            (message) =>
              message.compactFromSequence == null &&
              message.sequence >= boundary.compactFromSequence!
          ),
        ]
      : messages;
    return mergeToolResults(
      effectiveMessages.map((message) =>
        persistedMessageToSessionEvent(message, sessionId, {
          preserveCompactBoundaryText: true,
        })
      )
    );
  };

  return {
    category,
    loadAuthoritativeHistory,

    async loadHistory(
      sessionId: string,
      signal: AbortSignal
    ): Promise<SessionEvent[]> {
      const persistedMessages = await loadMessages(sessionId);
      if (signal.aborted || !persistedMessages?.length) return [];

      const events = persistedMessages.map((msg) =>
        persistedMessageToSessionEvent(msg, sessionId, {
          transformDisplayText: transformUserText
            ? (content, source) =>
                source === "user" ? transformUserText(content) : content
            : undefined,
        })
      );

      const merged = await mergeToolResults(events);
      if (signal.aborted) return merged;

      const { toolUsageByCallId, llmUsageByTurnId } =
        await loadUsageTelemetry(sessionId);
      if (signal.aborted) return merged;
      const usageHydrated = applyLlmUsageToEvents(
        applyToolUsageToEvents(merged, toolUsageByCallId),
        llmUsageByTurnId
      );

      await backfillSubagentLinks(sessionId, usageHydrated);
      return usageHydrated;
    },

    postLoad(sessionId: string, signal: AbortSignal): Promise<PostLoadResult> {
      return loadRustAgentPostLoadResult(sessionId, signal, {
        category,
        tokenUsageCommand,
      });
    },

    createEventHandler(
      sessionId: string,
      callbacks: EventHandlerCallbacks
    ): SessionEventHandler {
      return createRustAgentEventHandler({
        sessionId,
        callbacks,
        category,
        features,
        streamingControllers,
        getStreamingController,
      });
    },

    async sendMessage(input: AdapterSendInput): Promise<void> {
      const { sessionId } = input;
      clearSessionStreamingStopped(sessionId);
      await retryInvokeTauri(
        "agent_send_message",
        buildRustAgentSendMessageArgs(input),
        sessionId
      );
    },

    async stopSession(sessionId: string, reason: CancelReason): Promise<void> {
      markSessionStreamingStopped(sessionId);
      const existingController = streamingControllers.get(sessionId);
      const streamingController =
        existingController ?? getStreamingController(sessionId);
      streamingController.set(false);
      if (!existingController) streamingControllers.delete(sessionId);
      await cancel(sessionId, reason);
    },
  };
}

// ============================================================================
// Preset Configuration
// ============================================================================

/** Unified agent configuration — handles all Rust-native agents (OS, SDE, custom). */
export const AGENT_CONFIG: RustAgentConfig = {
  category: "agent",
  loadMessages: (sessionId) =>
    loadMessages(sessionId) as Promise<unknown> as Promise<PersistedMessage[]>,
  cancel: (sessionId, reason) =>
    cancelSession(sessionId, reason) as unknown as Promise<void>,
  tokenUsageCommand: "get_session_token_usage_records",
  features: {
    hasCodingSessionBridge: true,
    hasToolCallDelta: true,
    hasPermissionRequest: true,
    hasFileChangeEvents: true,
    hasStreamingDelta: true,
  },
};
