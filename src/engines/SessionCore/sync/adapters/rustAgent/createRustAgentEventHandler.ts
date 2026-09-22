/**
 * Per-session event handler for a Rust agent adapter: sequential dispatch of
 * channel events into the EventStore, running/completed status signaling,
 * hung-dispatch deadline and desync detection.
 */
import { createLogger } from "@src/hooks/logger";

import { noteSessionChannelActivity } from "../../sessionChannelActivity";
import type {
  EventHandlerCallbacks,
  RawSessionEvent,
  SessionEventHandler,
} from "../../types";
import type {
  AgentTokenUsage,
  AgentWSEvent,
  PermissionRequestEvent,
  QuestionRequestEvent,
  StreamingInfo,
} from "../shared/types";
import type { RustAgentFeatures } from "./eventHandlers";
import { createEventHandlerContext, dispatchAgentEvent } from "./eventHandlers";
import {
  isSessionStreamingStopped,
  noteSessionStreamingTurn,
  resetAllStreamingState,
} from "./eventHandlers/streamHelpers";
import type { StreamingEdgeController } from "./streamingEdgeController";
import {
  LIVE_STREAM_EVENTS_IGNORED_AFTER_STOP,
  PLAN_SUBMITTED_END_TURN_PREFIX,
  TERMINAL_EVENTS,
  isRustAgentTurnNeutralEvent,
} from "./turnEventClassification";
import {
  refreshUsageForLatestEvents,
  toTokenUsageInfo,
} from "./usageProjection";

const logger = createLogger("RustAgentAdapter");

interface RustAgentEventHandlerParams {
  sessionId: string;
  callbacks: EventHandlerCallbacks;
  category: string;
  features: RustAgentFeatures;
  /** Adapter-owned per-session streaming controllers; dispose releases ours. */
  streamingControllers: Map<string, StreamingEdgeController>;
  getStreamingController: (sessionId: string) => StreamingEdgeController;
}

export function createRustAgentEventHandler({
  sessionId,
  callbacks,
  category,
  features,
  streamingControllers,
  getStreamingController,
}: RustAgentEventHandlerParams): SessionEventHandler {
  const streamingController = getStreamingController(sessionId);

  // Two-flag system for status signaling:
  //
  // _runningSignaled: true while the current turn is in-flight (between first
  //   non-terminal event and terminal event processing). Prevents duplicate
  //   "running" signals within the same turn.
  //
  // _turnCompleted: true after a terminal event (agent:complete / agent:error)
  //   has been processed. Once set, no further event can re-trigger "running"
  //   until reset() is called (session switch). This blocks all trailing events
  //   Legacy trailing events are blocked here so old persisted/replayed
  //   summaries cannot re-trigger "running" after completion.
  let _runningSignaled = false;
  let _turnCompleted = false;
  // Disposal guard: set to true when dispose() is called so that any
  // in-flight promise chain steps are no-ops. Without this, a slow
  // promise chain could write events from the old session into the
  // new session's Rust EventStore after a session switch.
  let _disposed = false;

  // Event queue to ensure sequential processing (prevents race conditions)
  let eventQueuePromise = Promise.resolve();

  // One hung dispatch (an IPC invoke that never settles) must not starve
  // every later event — the terminal would never apply and the turn only
  // ends via the 60s planning watchdog. After the deadline the queue
  // moves on; the stalled dispatch's late outcome is logged, not thrown.
  const QUEUE_DISPATCH_DEADLINE_MS = 15_000;
  const withQueueDeadline = (
    dispatch: Promise<void>,
    eventType: string
  ): Promise<void> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        logger.error(
          `[${category}] dispatch of "${eventType}" on ${sessionId} ` +
            `exceeded ${QUEUE_DISPATCH_DEADLINE_MS}ms — releasing the ` +
            `event queue so terminal events cannot starve`
        );
        dispatch.then(
          () =>
            logger.warn(
              `[${category}] stalled "${eventType}" dispatch on ` +
                `${sessionId} eventually completed`
            ),
          (err) =>
            logger.warn(
              `[${category}] stalled "${eventType}" dispatch on ` +
                `${sessionId} eventually failed:`,
              err
            )
        );
        resolve();
      }, QUEUE_DISPATCH_DEADLINE_MS);
      dispatch.then(
        () => {
          clearTimeout(timer);
          resolve();
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        }
      );
    });

  // Consecutive dispatch failures within a single turn. A handler that
  // throws leaves the EventStore potentially inconsistent (a tool_call
  // row written but its result never paired, a delta lost). One isolated
  // failure is tolerable, but a run of them means the turn is silently
  // diverging from the Rust truth — at DISPATCH_FAILURE_THRESHOLD we
  // surface a "failed" status so the user sees the desync instead of a
  // session that hangs in "running" forever.
  let _consecutiveDispatchFailures = 0;
  const DISPATCH_FAILURE_THRESHOLD = 3;

  const ctx = createEventHandlerContext(sessionId, features, {
    onAgentComplete: (tokenUsage?: AgentTokenUsage) => {
      callbacks.onAgentComplete?.(
        tokenUsage ? toTokenUsageInfo(tokenUsage) : undefined
      );
    },
    onContextUsage: (contextUsage) => {
      callbacks.onContextUsage?.(contextUsage);
    },
    onTokenUpdate: (tokens) => {
      callbacks.onTokenUpdate?.(tokens);
    },
    onStatusChange: (
      status: string,
      errorMessage?: string,
      meta?: {
        turnId?: string;
        turnStatus?: string;
        intermediate?: boolean;
      }
    ) => {
      callbacks.onStatusChange?.(status, errorMessage, meta);
    },
    onPermissionRequest: features.hasPermissionRequest
      ? (event: PermissionRequestEvent) => {
          callbacks.onPermissionRequest?.({
            requestId: event.requestId,
            sessionId: event.sessionId,
            tool: event.tool,
            toolCallId: event.toolCallId,
            args: event.args,
          });
        }
      : undefined,
    onQuestionRequest: (event: QuestionRequestEvent) => {
      callbacks.onQuestionRequest?.({
        requestId: event.requestId,
        sessionId: event.sessionId,
        questions: event.questions,
        toolCallId: event.toolCallId,
      });
    },
    onStreamingDelta: features.hasStreamingDelta
      ? (info: StreamingInfo) => {
          callbacks.onStreamingDelta?.({
            isStreaming: info.isStreaming,
            isThinking: info.isThinking,
            content: info.content,
          });
        }
      : undefined,
    setStreaming: (value: boolean) => {
      streamingController.set(value);
    },
  });

  return {
    handleEvent(raw: RawSessionEvent): void {
      if (_disposed) {
        if (TERMINAL_EVENTS.has(raw.type)) {
          logger.warn(
            `[${category}] disposed handler swallowed ${raw.type} for ${sessionId}`
          );
        }
        return;
      }

      // Liveness stamp for EVERY channel event, before any filtering.
      // Ephemeral events (tool_call_delta, stream_retry) never reach the
      // EventStore, so this is the only place their arrival is recorded;
      // the planning watchdog reads it to distinguish "backend still
      // streaming" from "backend went silent".
      noteSessionChannelActivity(sessionId);

      const payload =
        raw.payload && typeof raw.payload === "object" ? raw.payload : {};
      const event = {
        ...raw,
        ...payload,
        type: raw.type,
      } as unknown as AgentWSEvent;

      if (LIVE_STREAM_EVENTS_IGNORED_AFTER_STOP.has(event.type)) {
        noteSessionStreamingTurn(sessionId, event.turnId);
      }

      const shouldIgnoreAfterStop =
        isSessionStreamingStopped(sessionId, event.turnId) &&
        LIVE_STREAM_EVENTS_IGNORED_AFTER_STOP.has(event.type);
      if (shouldIgnoreAfterStop) return;

      const isPlanReadyTerminal =
        event.type === "agent:plan_ready_for_approval" &&
        event.planEventSource === "create_plan";
      const isPlanSubmittedToolResult =
        event.type === "agent:tool_result" &&
        (event.tool === "create_plan" || event.toolName === "create_plan") &&
        typeof event.result === "string" &&
        event.result.startsWith(PLAN_SUBMITTED_END_TURN_PREFIX);
      const isTerminal = TERMINAL_EVENTS.has(event.type) || isPlanReadyTerminal;
      const isQueueStatus = event.type === "agent:queue_status";
      const queueIsProcessing = event.isProcessing === true;
      const isActiveQueueStatus = isQueueStatus && queueIsProcessing;
      const isTrailing =
        isRustAgentTurnNeutralEvent(event.type) ||
        isPlanSubmittedToolResult ||
        (isQueueStatus && !isActiveQueueStatus);

      if (isQueueStatus) {
        if (isActiveQueueStatus && !_runningSignaled) {
          _runningSignaled = true;
          callbacks.onStatusChange?.("running");
        }
      }

      // New turn detection: if _turnCompleted is true (previous turn ended) and
      // a genuine new-turn event (non-trailing, non-terminal) arrives, reset gate.
      if (_turnCompleted && !isTrailing && !isTerminal) {
        _turnCompleted = false;
        _runningSignaled = false;
      }

      // Signal "running" on the first substantive event of each turn.
      // Skip: terminal events (carry their own onStatusChange transition),
      //        trailing events (post-complete cleanup, must not flip status back).
      if (!_turnCompleted && !_runningSignaled && !isTerminal && !isTrailing) {
        _runningSignaled = true;
        callbacks.onStatusChange?.("running");
      }

      // Queue events for sequential processing.
      // Set _turnCompleted INSIDE the promise chain so it fires only after
      // the terminal handler's onStatusChange("completed"/"failed") has run.
      // Each step checks _disposed so that a session switch (dispose) stops
      // the chain from writing stale events into the new session's store.
      eventQueuePromise = eventQueuePromise
        .then(() => {
          if (_disposed) return;
          if (
            LIVE_STREAM_EVENTS_IGNORED_AFTER_STOP.has(event.type) &&
            isSessionStreamingStopped(sessionId, event.turnId)
          ) {
            return;
          }
          return withQueueDeadline(dispatchAgentEvent(event, ctx), event.type);
        })
        .then(() => {
          if (_disposed) return;
          // A clean dispatch resets the desync counter.
          _consecutiveDispatchFailures = 0;
          if (isTerminal) {
            _runningSignaled = false;
            _turnCompleted = true;
            void refreshUsageForLatestEvents(sessionId).catch((err) => {
              logger.warn(
                `[${category}] terminal tool usage refresh failed:`,
                err
              );
            });
          }
        })
        .catch((err) => {
          logger.error(
            `[${category}] event dispatch failed for "${event.type}" on ${sessionId}:`,
            err
          );
          if (_disposed) return;

          if (isTerminal) {
            // The terminal event itself failed to apply. Still mark the
            // turn completed so the input bar unlocks, but the counter
            // below will have already surfaced any prior desync.
            _runningSignaled = false;
            _turnCompleted = true;
            _consecutiveDispatchFailures = 0;
            return;
          }

          // Non-terminal failure mid-turn: the EventStore is now a step
          // out of sync with the Rust runtime. Count it; if the turn
          // keeps failing to apply events, break the silent divergence
          // by forcing a visible failed status.
          _consecutiveDispatchFailures += 1;
          if (
            _consecutiveDispatchFailures >= DISPATCH_FAILURE_THRESHOLD &&
            !_turnCompleted
          ) {
            logger.error(
              `[${category}] ${_consecutiveDispatchFailures} consecutive dispatch failures on ${sessionId} — surfacing failed status to break silent desync`
            );
            _runningSignaled = false;
            _turnCompleted = true;
            _consecutiveDispatchFailures = 0;
            callbacks.onStatusChange?.(
              "failed",
              "Event stream desynchronized — some agent output may be missing. Reload the session to recover."
            );
          }
        });
    },

    reset(): void {
      resetAllStreamingState(ctx);

      ctx.trackedCodingSessionsRef?.current.clear();

      _runningSignaled = false;
      _turnCompleted = false;
      _consecutiveDispatchFailures = 0;
      streamingController.set(false);
    },

    get isStreaming(): boolean {
      return streamingController.value;
    },

    dispose(): void {
      _disposed = true;
      this.reset();
      if (streamingControllers.get(sessionId) === streamingController) {
        streamingControllers.delete(sessionId);
      }
    },
  };
}
