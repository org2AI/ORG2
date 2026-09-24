import { getTurnGeneration } from "@src/engines/SessionCore/control/turnLifecycle";
import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import { createLogger } from "@src/hooks/logger";

import {
  type SessionLoadStateActions,
  applyPostLoadResult,
  capturePostLoadLifecycleSnapshot,
} from "./sessionSyncStateHelpers";
import type { SessionSyncRefs } from "./sessionSyncTypes";
import {
  IN_FLIGHT_HISTORY_RECONCILE_DELAYS_MS,
  hydrateSessionStoreBeforeDisplay,
  isTerminalRunStatus,
  loadPersistedHistory,
  waitForReconcileDelay,
} from "./sessionSyncUtils";
import type { SessionAdapter } from "./types";

const log = createLogger("SessionHistoryReconcile");

type PostLoadStateActions = Pick<
  SessionLoadStateActions,
  | "setSessionContextTokens"
  | "setSessionContextUsage"
  | "setSessionRuntimeStatus"
  | "setSessionRuntimeError"
>;

type ReconcileStateActions = Pick<
  SessionLoadStateActions,
  "dispatchLoadSession"
> &
  PostLoadStateActions;

export function reconcileInFlightHistory(
  sessionId: string,
  adapter: SessionAdapter,
  refs: Pick<SessionSyncRefs, "liveSessionIdRef">,
  actions: ReconcileStateActions
): void {
  let generation = getTurnGeneration(sessionId);
  const isCurrent = () =>
    refs.liveSessionIdRef.current === sessionId &&
    getTurnGeneration(sessionId) === generation;
  const reconcile = async () => {
    let lastError: unknown;
    const reconcileController = new AbortController();
    for (const delayMs of IN_FLIGHT_HISTORY_RECONCILE_DELAYS_MS) {
      await waitForReconcileDelay(delayMs);
      if (!isCurrent()) return;

      if (!isCurrent()) return;
      try {
        const postLoadLifecycle = capturePostLoadLifecycleSnapshot(sessionId);
        const postResult = adapter.postLoad
          ? await adapter.postLoad(sessionId, reconcileController.signal)
          : null;
        if (!isCurrent()) return;

        const persistedEvents = await loadPersistedHistory(
          adapter,
          sessionId,
          reconcileController.signal
        );
        if (!isCurrent() || persistedEvents.length === 0) {
          continue;
        }

        // Native-transcript CLI sessions: the live turn renders from in-memory
        // events only (optimistic user bubble + streamed broadcasts). Repeated
        // replay merges here were the "~5s" duplicate-bubble source — each tick
        // parked replay rows (synthesized fallback, then the real
        // `codex-user-N` parse) next to them under never-matching ids. Only an
        // EMPTY store (switched into a still-running session after a restart or
        // eviction) is hydrated, with replace semantics so a retry tick stays
        // idempotent; the terminal reconcile owns the final canonical replace.
        if (postResult?.transcriptSource === "native") {
          const existingEvents = await eventStoreProxy.getEvents(sessionId);
          if (!isCurrent()) return;
          if (existingEvents.length === 0) {
            await hydrateSessionStoreBeforeDisplay(
              sessionId,
              persistedEvents,
              "replace"
            );
            if (!isCurrent()) return;
            actions.dispatchLoadSession({
              sessionId,
              events: persistedEvents,
              replace: true,
            });
          }
        } else {
          await hydrateSessionStoreBeforeDisplay(
            sessionId,
            persistedEvents,
            "merge"
          );
          if (!isCurrent()) return;
          actions.dispatchLoadSession({ sessionId, events: persistedEvents });
        }

        applyPostLoadResult(sessionId, postResult, actions, {
          lifecycleSnapshot: postLoadLifecycle,
          acceptTerminalForUnchangedGeneration: true,
        });
        // Applying the observed running status can itself advance the local
        // lifecycle generation. Carry only our own synchronous transition.
        generation = getTurnGeneration(sessionId);
        if (isTerminalRunStatus(postResult?.runStatus)) return;
      } catch (error) {
        if (!isCurrent()) return;
        // A just-created provider session may not have flushed its file yet.
        // Retry the existing bounded ladder; never turn a failed read into an
        // empty history or replace live events with an incomplete transcript.
        lastError = error;
      }
    }
    if (lastError && isCurrent()) {
      log.warn(
        `History reconciliation unavailable for ${sessionId}`,
        lastError
      );
      actions.setSessionRuntimeError(
        lastError instanceof Error ? lastError.message : String(lastError)
      );
    }
  };

  // The lifecycle owns this background promise. Even a status/storage failure
  // must remain session-local rather than reaching the global App error page.
  void reconcile().catch((error: unknown) => {
    if (!isCurrent()) return;
    log.warn(`History reconciliation failed for ${sessionId}`, error);
    actions.setSessionRuntimeError(
      error instanceof Error ? error.message : String(error)
    );
  });
}

export function applySwitchPostLoadResult(
  sessionId: string,
  postResult: Parameters<typeof applyPostLoadResult>[1],
  actions: PostLoadStateActions
): void {
  applyPostLoadResult(sessionId, postResult, actions);
}
