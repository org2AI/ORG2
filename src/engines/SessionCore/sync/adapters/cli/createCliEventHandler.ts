import { cliSessionContextUsage } from "@src/api/tauri/session/contextUsage";
import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import { handleInteractionFinalized } from "@src/engines/SessionCore/sync/adapters/rustAgent/eventHandlers/toolHandlers";
import { createLogger } from "@src/hooks/logger";
import {
  clearPendingPermissionRequest,
  pendingPermissionRequestsAtom,
} from "@src/store/session/permissionRequestAtom";
import type {
  ActivityChunk,
  CliSessionStatus,
} from "@src/types/session/session";
import { isSessionRuntimeExecuting } from "@src/util/session/sessionRuntimeExecuting";

import type {
  EventHandlerCallbacks,
  RawSessionEvent,
  SessionEventHandler,
} from "../../types";
import type { AgentWSEvent } from "../shared/types";
import { asString, getStore } from "./cliEventHandlerHelpers";
import {
  handleCliPermissionRequest,
  handleExitPlanMode,
  handlePlanApprovalArchivedBroadcast,
  handlePlanReadyForApproval,
} from "./cliInteractionEvents";
import {
  isCliTerminalStatus,
  markObservedCliTerminalStatus,
  trackCliEventPersistence,
} from "./cliLifecycle";
import {
  handleMergeResult,
  handleWorktreeCreated,
} from "./cliSessionRowEvents";
import { createCliActivityHandlers } from "./createCliActivityHandlers";

const log = createLogger("CliAdapter");

export function createCliEventHandler(
  sessionId: string,
  callbacks: EventHandlerCallbacks
): SessionEventHandler {
  let streaming = false;
  let cancelled = false;
  let disposed = false;
  let contextGeneration = 0;
  let contextReadPending = false;
  let contextReadQueued = false;

  function requestContextRefresh(): void {
    refreshContext().catch((error: unknown) => {
      log.warn("CLI context refresh failed", error);
    });
  }

  async function refreshContext(): Promise<void> {
    if (disposed) return;
    if (contextReadPending) {
      contextReadQueued = true;
      return;
    }
    contextReadPending = true;
    contextReadQueued = false;
    const generation = contextGeneration;
    try {
      const usage = await cliSessionContextUsage(sessionId);
      if (!disposed && generation === contextGeneration) {
        callbacks.onTokenUpdate?.(usage?.usedTokens ?? 0, usage);
      }
    } finally {
      contextReadPending = false;
      if (contextReadQueued && !disposed) requestContextRefresh();
    }
  }

  let observedTerminalStatus: CliSessionStatus | undefined;

  function setStreamingMode(active: boolean): void {
    if (streaming !== active) {
      streaming = active;
      eventStoreProxy.setStreaming(active, sessionId);
    }
  }

  function reconcileTerminalEventsIfNeeded(): void {
    if (!observedTerminalStatus) return;
    void markObservedCliTerminalStatus(sessionId, observedTerminalStatus).catch(
      (error: unknown) => {
        log.error("CLI terminal reconciliation failed", error);
      }
    );
  }

  /**
   * Register the exact normalization + EventStore write with the CLI
   * lifecycle barrier. The terminal status and background native reconcile
   * may otherwise overtake this promise and snapshot an older transcript.
   */
  function persistObservedEvent(operation: Promise<unknown>): void {
    trackCliEventPersistence(sessionId, operation);
    void operation.then(reconcileTerminalEventsIfNeeded).catch((error) => {
      log.warn("[CliAdapter] normalizeChunkRust failed:", error);
    });
  }

  const {
    handleActivity,
    handleStreamingComplete,
    clearMessageStream,
    clearThinkingStream,
    clearToolCallDeltaBuffers,
  } = createCliActivityHandlers({
    sessionId,
    setStreamingMode,
    persistObservedEvent,
    onActivityObserved: () => {
      if (cancelled) cancelled = false;
    },
  });

  function handleStatusChange(raw: RawSessionEvent): void {
    const status = raw.status as string;
    const terminalStatus = isCliTerminalStatus(status as CliSessionStatus)
      ? (status as CliSessionStatus)
      : undefined;
    if (terminalStatus) {
      observedTerminalStatus = terminalStatus;
      clearMessageStream();
      clearThinkingStream();
      clearToolCallDeltaBuffers();
      setStreamingMode(false);
      if (status === "cancelled") cancelled = true;
      // Do not expose the runtime as switchable until visible partial message
      // buffers and interrupted tool-call fences are durably terminalized.
      // Otherwise a fast Stop -> runtime switch can read the old native fork
      // before EventStore owns the interrupted suffix.
      void markObservedCliTerminalStatus(sessionId, observedTerminalStatus)
        .then(() => {
          if (disposed) return;
          // The shared lifecycle callback owns native transcript reconciliation.
          // Notify it after streamed writes settle, preserving the turn identity
          // so a late terminal cannot reconcile a newer dispatch.
          callbacks.onStatusChange?.(
            status,
            asString(raw.error_message) ?? asString(raw.errorMessage),
            {
              turnIntentId:
                asString(raw.turn_intent_id) ?? asString(raw.turnIntentId),
            }
          );
          callbacks.onAgentComplete?.();
        })
        .catch((error: unknown) => {
          log.error("CLI terminal completion failed", error);
        });
    }

    if (isSessionRuntimeExecuting(status)) {
      observedTerminalStatus = undefined;
      cancelled = false;
    }
  }

  return {
    handleEvent(raw: RawSessionEvent): void {
      if (disposed) return;
      const msgSessionId =
        (raw.session_id as string) || (raw.sessionId as string);
      if (msgSessionId !== sessionId) return;

      if (raw.type === "native_interaction:resolved") {
        if (typeof raw.requestId === "string" && raw.requestId) {
          getStore()?.set(pendingPermissionRequestsAtom, (prev) =>
            clearPendingPermissionRequest(
              prev,
              sessionId,
              raw.requestId as string
            )
          );
        }
        window.dispatchEvent(
          new CustomEvent("native-interaction-resolved", {
            detail: { sessionId, requestId: raw.requestId },
          })
        );
      } else if (raw.type === "agent:interaction_finalized") {
        handleInteractionFinalized(raw as unknown as AgentWSEvent, sessionId);
      } else if (raw.type === "permission:resolved") {
        if (typeof raw.requestId === "string" && raw.requestId) {
          getStore()?.set(pendingPermissionRequestsAtom, (prev) =>
            clearPendingPermissionRequest(
              prev,
              sessionId,
              raw.requestId as string
            )
          );
        }
      } else if (raw.type === "permission:request") {
        handleCliPermissionRequest(sessionId, raw);
      } else if (raw.type === "agent:plan_ready_for_approval") {
        handlePlanReadyForApproval(sessionId, raw);
      } else if (raw.type === "agent:exit_plan_mode") {
        handleExitPlanMode(sessionId, raw);
      } else if (raw.type === "agent:plan_approval_archived") {
        handlePlanApprovalArchivedBroadcast(sessionId, raw);
      } else if (raw.type === "code_session.activity" && raw.chunk) {
        handleActivity(
          raw.chunk as unknown as ActivityChunk,
          asString(raw.turn_intent_id) ?? asString(raw.turnIntentId)
        );
      } else if (raw.type === "agent:streaming_complete") {
        handleStreamingComplete(raw);
      } else if (raw.type === "code_session.status_changed") {
        handleStatusChange(raw);
      } else if (raw.type === "code_session.token_usage_updated") {
        const total = raw.total_tokens;
        // Billing events invalidate telemetry; their cumulative total is not context.
        if (typeof total === "number") requestContextRefresh();
      } else if (raw.type === "code_session.worktree_created") {
        handleWorktreeCreated(msgSessionId, raw);
      } else if (raw.type === "code_session.merge_result") {
        handleMergeResult(msgSessionId, raw);
      }
    },

    reset(): void {
      contextGeneration += 1;
      contextReadQueued = false;
      clearMessageStream();
      clearThinkingStream();
      clearToolCallDeltaBuffers();
      observedTerminalStatus = undefined;
      cancelled = false;
      setStreamingMode(false);
    },

    get isStreaming(): boolean {
      return streaming;
    },

    dispose(): void {
      disposed = true;
      this.reset();
    },
  };
}
