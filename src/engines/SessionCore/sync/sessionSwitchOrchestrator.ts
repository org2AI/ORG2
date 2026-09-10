import { cursorIdeComposerLastUpdatedAt } from "@src/api/tauri/externalHistory/cursorIde";
import { Message } from "@src/components/Message";
import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import { isVisibleInChat } from "@src/engines/SessionCore/ingestion/visibilityFilters";
import type { Logger } from "@src/hooks/logger";
import {
  composerIdFromSessionId,
  isCollaborationImportedSession,
  isImportedHistorySession,
} from "@src/util/session/sessionDispatch";

import { getTurnGeneration, isTurnActive } from "../control/turnLifecycle";
import { getCursorIdeSnapshotLastUpdatedAt } from "./adapters/cursorIdeAdapter";
import {
  type NativeHistoryLoadRevision,
  loadWithNativeHistoryRevision,
} from "./nativeHistoryLoadRevision";
import { isCursorIdeSessionId } from "./sessionSyncDerivedState";
import { rehydratePendingPlanApproval } from "./sessionSyncPlanApproval";
import { reconcileInFlightHistory } from "./sessionSyncReconcile";
import {
  type SessionLoadStateActions,
  applyPostLoadResult,
  capturePostLoadLifecycleSnapshot,
  isPostLoadRunStatusSuperseded,
} from "./sessionSyncStateHelpers";
import type { SessionSyncRefs } from "./sessionSyncTypes";
import {
  hydrateSessionStoreBeforeDisplay,
  isInFlightRunStatus,
  loadPersistedHistory,
} from "./sessionSyncUtils";
import type { SessionAdapter } from "./types";

interface SessionSwitchOrchestratorOptions {
  sessionId: string;
  adapter: SessionAdapter;
  abortController: AbortController;
  refs: Pick<SessionSyncRefs, "liveSessionIdRef">;
  actions: SessionLoadStateActions;
  setPendingPlanApprovals: Parameters<typeof rehydratePendingPlanApproval>[2];
  logger: Logger;
}

export function runSessionSwitchOrchestrator(
  options: SessionSwitchOrchestratorOptions
): void {
  const switchSession = async () => {
    const {
      sessionId,
      adapter,
      abortController,
      refs,
      actions,
      setPendingPlanApprovals,
    } = options;

    try {
      const cacheHit = await eventStoreProxy.switchSession(sessionId);
      if (abortController.signal.aborted) return;
      if (cacheHit) {
        await handleCacheHit({
          sessionId,
          adapter,
          abortController,
          refs,
          actions,
          setPendingPlanApprovals,
        });
        return;
      }

      await handleCacheMiss({
        sessionId,
        adapter,
        abortController,
        refs,
        actions,
        setPendingPlanApprovals,
      });
    } catch (error) {
      if (!options.abortController.signal.aborted) {
        const detail = error instanceof Error ? error.message : String(error);
        options.logger.error(
          `failed to load history for ${options.sessionId}:`,
          error
        );
        options.actions.failSessionLoad(detail);
        Message.error({
          content: `Failed to load session history: ${detail}`,
          duration: 5000,
        });
      }
    }
  };

  void switchSession();
}

async function handleCacheHit(
  options: Pick<
    SessionSwitchOrchestratorOptions,
    | "sessionId"
    | "adapter"
    | "abortController"
    | "refs"
    | "actions"
    | "setPendingPlanApprovals"
  >
): Promise<void> {
  const {
    sessionId,
    adapter,
    abortController,
    refs,
    actions,
    setPendingPlanApprovals,
  } = options;

  if (isCursorIdeSessionId(sessionId)) {
    const handled = await handleCursorIdeCacheHit(
      sessionId,
      adapter,
      abortController,
      actions
    );
    if (handled) return;
  }

  actions.setLoadStatus("loading");

  const postLoadLifecycle = capturePostLoadLifecycleSnapshot(sessionId);
  const postResult = adapter.postLoad
    ? await adapter.postLoad(sessionId, abortController.signal)
    : null;
  if (abortController.signal.aborted) return;

  // The DB status alone is not enough: right after an abort the row is
  // terminal ("cancelled") while the frontend FSM is already dispatching the
  // follow-up turn — treating that window as not-in-flight lets a stale
  // history replace wipe the just-sent message.
  let cacheHitInFlight =
    (!isPostLoadRunStatusSuperseded(
      sessionId,
      postResult?.runStatus,
      postLoadLifecycle
    ) &&
      isInFlightRunStatus(postResult?.runStatus)) ||
    isTurnActive(sessionId);
  let displayEvents = await eventStoreProxy.getEvents(sessionId);
  if (abortController.signal.aborted) return;

  let nativeHistoryRevision: NativeHistoryLoadRevision | undefined;
  let storeHydrated = false;
  if (!cacheHitInFlight) {
    if (
      adapter.category === "cli" &&
      postResult?.transcriptSource === "native"
    ) {
      // SQLite can contain only streamed assistant answers. A visible cache
      // is not an authoritative native transcript or command catalog. Read
      // the bounded native window once on activation, even on a cache hit.
      const generation = getTurnGeneration(sessionId);
      const loaded = await loadWithNativeHistoryRevision(
        sessionId,
        abortController.signal,
        () => loadPersistedHistory(adapter, sessionId, abortController.signal)
      );
      if (abortController.signal.aborted) return;
      cacheHitInFlight = isTurnActive(sessionId);
      if (!cacheHitInFlight && generation === getTurnGeneration(sessionId)) {
        displayEvents = loaded.value;
        await hydrateSessionStoreBeforeDisplay(sessionId, displayEvents);
        storeHydrated = true;
        nativeHistoryRevision = loaded.nativeHistoryRevision;
      } else {
        // A turn started (or finished) while the disk read was pending.
        // Preserve its live projection instead of replacing it with old data.
        displayEvents = await eventStoreProxy.getEvents(sessionId);
      }
    } else if (
      adapter.category === "agent" &&
      isCollaborationImportedSession(sessionId)
    ) {
      // The round window excludes local failed-delivery sidecars. Reuse the
      // same persisted projection as a cold load so a cache hit cannot erase
      // Retry/Edit after that cold load restored it.
      displayEvents = await loadPersistedHistory(
        adapter,
        sessionId,
        abortController.signal
      );
      if (abortController.signal.aborted) return;
      await hydrateSessionStoreBeforeDisplay(sessionId, displayEvents);
    } else if (adapter.category === "agent") {
      await eventStoreProxy.loadInitialTurnWindow(
        sessionId,
        isCollaborationImportedSession(sessionId) ? 0 : undefined
      );
      if (abortController.signal.aborted) return;
      displayEvents = await eventStoreProxy.getEvents(sessionId);
      // The round-window load can resolve to zero chat-visible events when
      // the turn index is mid-rebuild (e.g. switching into a session right
      // after it finished a long run), and `set_round_window` overwrites the
      // in-memory store unconditionally. Without this guard the panel renders
      // "loaded + 0 events" until the user hits Reload. Fall back to the full
      // initial load (which itself falls back to `loadEvents` when the turn
      // index is empty) and re-hydrate the store so the events actually show.
      if (displayEvents.length === 0 || !displayEvents.some(isVisibleInChat)) {
        const fallbackEvents = await loadPersistedHistory(
          adapter,
          sessionId,
          abortController.signal
        );
        if (abortController.signal.aborted) return;
        if (fallbackEvents.length > 0) {
          await hydrateSessionStoreBeforeDisplay(sessionId, fallbackEvents);
          if (abortController.signal.aborted) return;
          displayEvents = fallbackEvents;
        }
      }
    } else if (
      displayEvents.length === 0 ||
      !displayEvents.some(isVisibleInChat)
    ) {
      displayEvents = await loadPersistedHistory(
        adapter,
        sessionId,
        abortController.signal
      );
      if (abortController.signal.aborted) return;
      await hydrateSessionStoreBeforeDisplay(sessionId, displayEvents);
    }
    if (abortController.signal.aborted) return;
  }

  actions.dispatchLoadSession({
    sessionId,
    events: displayEvents,
    isFromCache: !storeHydrated,
    ...(storeHydrated ? { storeHydrated, nativeHistoryRevision } : {}),
  });
  rehydratePendingPlanApproval(
    sessionId,
    abortController,
    setPendingPlanApprovals
  );
  if (
    cacheHitInFlight &&
    !isImportedHistorySession(sessionId) &&
    !isCollaborationImportedSession(sessionId)
  ) {
    reconcileInFlightHistory(sessionId, adapter, refs, actions);
  }
  applyPostLoadResult(sessionId, postResult, actions, {
    lifecycleSnapshot: postLoadLifecycle,
  });
}

async function handleCursorIdeCacheHit(
  sessionId: string,
  adapter: SessionAdapter,
  abortController: AbortController,
  actions: Pick<
    SessionLoadStateActions,
    "dispatchLoadSession" | "setLoadStatus"
  >
): Promise<boolean> {
  actions.setLoadStatus("loading");
  const composerId = composerIdFromSessionId(sessionId);
  const currentUpdatedAt = composerId
    ? await cursorIdeComposerLastUpdatedAt(composerId)
    : null;
  if (abortController.signal.aborted) return true;
  const cachedUpdatedAt = getCursorIdeSnapshotLastUpdatedAt(sessionId);
  if (currentUpdatedAt !== null && cachedUpdatedAt === currentUpdatedAt) {
    const cachedEvents = await eventStoreProxy.getEvents();
    if (abortController.signal.aborted) return true;
    actions.dispatchLoadSession({ sessionId, events: cachedEvents });
    return true;
  }

  const events = await adapter.loadHistory(sessionId, abortController.signal);
  if (abortController.signal.aborted) return true;
  await eventStoreProxy.set(events, sessionId);
  if (abortController.signal.aborted) return true;
  actions.dispatchLoadSession({ sessionId, events });
  return true;
}

async function handleCacheMiss(
  options: Pick<
    SessionSwitchOrchestratorOptions,
    | "sessionId"
    | "adapter"
    | "abortController"
    | "refs"
    | "actions"
    | "setPendingPlanApprovals"
  >
): Promise<void> {
  const {
    sessionId,
    adapter,
    abortController,
    refs,
    actions,
    setPendingPlanApprovals,
  } = options;

  actions.setLoadStatus("loading");

  const postLoadLifecycle = capturePostLoadLifecycleSnapshot(sessionId);
  const missPostResult = adapter.postLoad
    ? await adapter.postLoad(sessionId, abortController.signal)
    : null;
  if (abortController.signal.aborted) return;

  const missInFlight =
    (!isPostLoadRunStatusSuperseded(
      sessionId,
      missPostResult?.runStatus,
      postLoadLifecycle
    ) &&
      isInFlightRunStatus(missPostResult?.runStatus)) ||
    isTurnActive(sessionId);
  const load = () =>
    !missInFlight
      ? loadPersistedHistory(adapter, sessionId, abortController.signal)
      : adapter.loadHistory(sessionId, abortController.signal);
  const { value: events, nativeHistoryRevision } =
    adapter.category === "cli" && !missInFlight
      ? await loadWithNativeHistoryRevision(
          sessionId,
          abortController.signal,
          load
        )
      : { value: await load(), nativeHistoryRevision: undefined };
  if (abortController.signal.aborted) return;
  await hydrateSessionStoreBeforeDisplay(
    sessionId,
    events,
    missInFlight ? "merge" : "replace"
  );
  if (abortController.signal.aborted) return;

  actions.dispatchLoadSession({
    sessionId,
    events,
    nativeHistoryRevision,
    storeHydrated: adapter.category === "cli" && !missInFlight,
  });
  if (
    missInFlight &&
    !isImportedHistorySession(sessionId) &&
    !isCollaborationImportedSession(sessionId)
  ) {
    reconcileInFlightHistory(sessionId, adapter, refs, actions);
  }

  applyPostLoadResult(sessionId, missPostResult, actions, {
    lifecycleSnapshot: postLoadLifecycle,
  });

  rehydratePendingPlanApproval(
    sessionId,
    abortController,
    setPendingPlanApprovals
  );
}
