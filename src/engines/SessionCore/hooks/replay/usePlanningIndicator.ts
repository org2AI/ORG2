/**
 * usePlanningIndicator Hook
 *
 * Shows a single "Planning next step..." line in the chat panel when:
 * 1. Any session type is actively working (code / cloud / OS agent)
 * 2. No store mutations for IDLE_THRESHOLD_MS (1 second)
 *
 * The indicator stays visible until new events arrive or the session ends.
 *
 * Watchdog: if the indicator stays visible for PLANNING_WATCHDOG_MS (60s),
 * query the backend-authoritative session status. A live provider may spend
 * minutes inside one silent shell tool; channel silence alone is not proof
 * that the turn ended. Only a terminal backend status may settle the UI.
 *
 * Reads directly from derivedSnapshotAtom (NOT eventsAtom). During streaming,
 * Rust pushes StreamingSnapshot which has no `events` field, causing eventsAtom
 * to return []. Both snapshot types now carry `hasRunningEvent` (computed
 * against ALL events, including non-chat-visible ones like thinking deltas).
 * Running events are used only to keep the watchdog from force-completing a
 * legitimate long tool call; they do not suppress the idle footer.
 *
 * Uses snapshot `version` as the activity token — it bumps on every store
 * mutation (upsert, append, merge), including streaming deltas for thinking
 * and assistant messages. This avoids iterating chatEvents for text length.
 *
 * Cold-start visibility is handled by {@link usePlanningIdleTiming}: the
 * first active render records `activationVersion`, so the footer can appear
 * on the next paint without waiting the full idle debounce. Subsequent store
 * mutations re-arm the 1-second idle timer to prevent flicker between tools.
 */
import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useState } from "react";

import { eventStoreVersionAtom } from "@src/engines/SessionCore/core/atoms/events";
import { sessionIdAtom } from "@src/engines/SessionCore/core/atoms/metadata";
import {
  globalAnyRunningAtom,
  globalHasAwaitingUserInteractionAtom,
  globalHasRunningAwaitWaitForAtom,
  noopPlanningBooleanAtom,
  noopPlanningRuntimeStatusAtom,
  noopPlanningSessionIdAtom,
  noopPlanningVersionAtom,
  noopStreamRetryStatusAtom,
  noopSubagentJobMapAtom,
} from "@src/engines/SessionCore/derived/planningIndicatorAtoms";
import {
  noopSessionScopedPlanningMetaAtom,
  sessionScopedPlanningMetaAtomFamily,
} from "@src/engines/SessionCore/derived/sessionScopedChatEvents";
import { usePlanningIdleTiming } from "@src/engines/SessionCore/hooks/replay/planningIndicatorIdleTiming";
import { SessionService } from "@src/engines/SessionCore/services/SessionService";
import { msSinceSessionChannelActivity } from "@src/engines/SessionCore/sync/sessionChannelActivity";
import { createLogger } from "@src/hooks/logger";
import {
  type CliSessionStatus,
  isPendingCancelAtom,
  isSessionActiveAtom,
  sessionRuntimeStatusAtom,
  setSessionRuntimeStatusAtom,
  streamRetryStatusAtom,
} from "@src/store/session/cliSessionStatusAtom";
import {
  hasLiveSubagentJobs,
  subagentJobMapAtom,
} from "@src/store/session/subagentJobAtom";
import { isActiveStatus, isTerminalStatus } from "@src/types/session/session";

const log = createLogger("usePlanningIndicator");

/**
 * How long (ms) the planning indicator may stay visible before the watchdog
 * force-completes the session. Generous because legitimate "LLM is wrapping
 * up after a tool batch" pauses can reach 10–20s on slow providers; anything
 * past a full minute almost certainly indicates a missed `agent:complete`.
 */
const PLANNING_WATCHDOG_MS = 60_000;

/**
 * Decide what the watchdog should do when its timer fires, given how long
 * ago the session's IPC channel last delivered ANY event.
 *
 * Returns `null` to trip (fire the force-complete), or a positive delay in
 * ms to re-arm for. Pure so the recency policy is unit-testable without
 * faking React timers.
 *
 * - `null` recency (no event observed since app start) trips: with the
 *   channel silent for the whole watchdog window there is nothing to prove
 *   the backend is alive, which is exactly the event-loss case the watchdog
 *   exists for.
 * - Recent activity re-arms for the REMAINDER of the window so a turn that
 *   streams ephemeral deltas (never bumping the store version) is probed at
 *   the right moment instead of on a fixed cadence.
 */
export function planningWatchdogDelayMs(
  msSinceChannelActivity: number | null,
  watchdogMs: number = PLANNING_WATCHDOG_MS
): number | null {
  if (msSinceChannelActivity === null) return null;
  if (msSinceChannelActivity >= watchdogMs) return null;
  return watchdogMs - msSinceChannelActivity;
}

/**
 * Map a backend-authoritative status to the UI action the watchdog may take.
 * `null` means the provider is still alive (or waiting for the user), so the
 * watchdog must re-arm instead of manufacturing a terminal event.
 */
export function planningWatchdogTerminalStatus(
  status: string
): CliSessionStatus | null {
  // `idle` means the backend has released this turn; `paused` likewise has no
  // executing work for the planning footer to represent. Other active states
  // must remain open even when their channel is temporarily silent.
  if (status === "idle" || status === "paused") return "completed";
  if (isActiveStatus(status)) return null;
  // Unknown/new backend statuses are not proof of completion. Only the shared
  // terminal vocabulary may settle the UI.
  if (!isTerminalStatus(status)) return null;
  if (status === "completed") return "completed";
  if (status === "cancelled") return "cancelled";
  if (
    status === "failed" ||
    status === "error" ||
    status === "abandoned" ||
    status === "timeout" ||
    status === "archived"
  ) {
    return status;
  }
  // Market-only terminal values (for example `killed`) collapse to the
  // closest local-session presentation status.
  return "failed";
}

export interface PlanningIndicatorVisibilityInput {
  runtimeStatus: string;
  isSessionActive: boolean;
  isPendingCancel: boolean;
  hasAwaitingUserInteraction: boolean;
  anyRunning: boolean;
  coldStartVisible: boolean;
  idleAfterVersion: number | null;
  version: number;
  /**
   * True when the (global) session has a still-running background subagent.
   * The parent turn can mechanically end (runtimeStatus → idle) while a
   * `agent(background: true)` worker keeps running; without this the footer
   * would vanish during that gap even though work is clearly ongoing.
   */
  hasLiveSubagent: boolean;
  /**
   * True while the latest turn has a still-running `await_output` wait_for.
   * That call renders its own live "Waiting {countdown} for …" title, so the
   * planning footer is suppressed to avoid two stacked waiting indicators.
   */
  hasRunningAwaitWaitFor: boolean;
}

export function shouldShowPlanningIndicator({
  runtimeStatus,
  isSessionActive,
  isPendingCancel,
  hasAwaitingUserInteraction,
  coldStartVisible,
  idleAfterVersion,
  version,
  hasLiveSubagent,
  hasRunningAwaitWaitFor,
}: PlanningIndicatorVisibilityInput): boolean {
  const runtimeCanShowPlanning =
    runtimeStatus === "running" ||
    runtimeStatus === "installing" ||
    runtimeStatus === "waiting_for_user" ||
    runtimeStatus === "waiting_for_funds" ||
    hasLiveSubagent;
  return (
    runtimeCanShowPlanning &&
    isSessionActive &&
    !isPendingCancel &&
    !hasAwaitingUserInteraction &&
    !hasRunningAwaitWaitFor &&
    (coldStartVisible || idleAfterVersion === version)
  );
}

export interface PlanningIndicatorState {
  /** 1 when the planning footer should show, 0 when hidden */
  count: 0 | 1;
  /**
   * Stable random index used by the footer to pick one phrasing variant
   * from the localized variant array. Re-rolled every time the indicator
   * transitions hidden → visible; stays fixed for the whole visible span
   * so the text does not shuffle mid-wait.
   */
  variantIndex: number;
}

/**
 * Session-scoped mode for `usePlanningIndicator`.
 *
 * The default (no scope) reads the GLOBAL active-session atoms
 * (`isSessionActiveAtom`, `sessionRuntimeStatusAtom`, `derivedSnapshotAtom`,
 * `eventStoreVersionAtom`) — correct for the primary ChatPanel only. A
 * session-scoped ChatHistory instance (subagent monitor cell) must pass a
 * scope so the footer is driven by ITS session's snapshot channel instead
 * of the parent's.
 *
 * `isLive` is supplied by the surface because subagent sessions are not in
 * the global sidebar session map — the monitor strip already holds the
 * backend-authoritative status (`es_get_child_sessions` → endedAt). The
 * caller should also fold replay state into it (a scrubbed cell shows a
 * historical slice; a footer there would lie).
 */
export interface PlanningIndicatorScope {
  sessionId: string;
  isLive: boolean;
}

export function usePlanningIndicator(
  scope?: PlanningIndicatorScope | null
): PlanningIndicatorState {
  const scoped = Boolean(scope);
  const globalIsSessionActive = useAtomValue(
    scoped ? noopPlanningBooleanAtom : isSessionActiveAtom
  );
  const globalIsPendingCancel = useAtomValue(
    scoped ? noopPlanningBooleanAtom : isPendingCancelAtom
  );
  const globalRuntimeStatus = useAtomValue(
    scoped ? noopPlanningRuntimeStatusAtom : sessionRuntimeStatusAtom
  );
  const globalVersion = useAtomValue(
    scoped ? noopPlanningVersionAtom : eventStoreVersionAtom
  );
  const sessionId = useAtomValue(
    scoped ? noopPlanningSessionIdAtom : sessionIdAtom
  );
  const subagentJobMap = useAtomValue(
    scoped ? noopSubagentJobMapAtom : subagentJobMapAtom
  );
  const streamRetryStatus = useAtomValue(
    scoped ? noopStreamRetryStatusAtom : streamRetryStatusAtom
  );
  const setSessionRuntimeStatus = useSetAtom(setSessionRuntimeStatusAtom);
  const scopedMeta = useAtomValue(
    scope
      ? sessionScopedPlanningMetaAtomFamily(scope.sessionId)
      : noopSessionScopedPlanningMetaAtom
  );

  const isSessionActive = scoped
    ? Boolean(scope?.isLive)
    : globalIsSessionActive;
  const isPendingCancel = scoped ? false : globalIsPendingCancel;
  const runtimeStatus = scoped
    ? scope?.isLive
      ? "running"
      : "idle"
    : globalRuntimeStatus;
  const version = scoped ? scopedMeta.version : globalVersion;
  const effectiveSessionId = scoped ? (scope?.sessionId ?? null) : sessionId;

  const globalAnyRunning = useAtomValue(
    scoped ? noopPlanningBooleanAtom : globalAnyRunningAtom
  );
  const anyRunning = scoped ? scopedMeta.anyRunning : globalAnyRunning;

  const globalHasAwaitingUserInteraction = useAtomValue(
    scoped ? noopPlanningBooleanAtom : globalHasAwaitingUserInteractionAtom
  );
  const hasAwaitingUserInteraction = scoped
    ? scopedMeta.hasAwaitingUserInteraction
    : globalHasAwaitingUserInteraction;

  const globalHasRunningAwaitWaitFor = useAtomValue(
    scoped ? noopPlanningBooleanAtom : globalHasRunningAwaitWaitForAtom
  );
  const hasRunningAwaitWaitFor = scoped
    ? scopedMeta.hasRunningAwaitWaitFor
    : globalHasRunningAwaitWaitFor;

  const { activationVersion, idleAfterVersion } = usePlanningIdleTiming(
    isSessionActive,
    version
  );

  const coldStartVisible =
    activationVersion !== null && activationVersion === version;
  const hasLiveSubagent = scoped
    ? false
    : hasLiveSubagentJobs(subagentJobMap, effectiveSessionId);
  const hasPendingStreamRetry =
    !scoped && streamRetryStatus?.sessionId === effectiveSessionId;
  const visible = shouldShowPlanningIndicator({
    runtimeStatus,
    isSessionActive,
    isPendingCancel,
    hasAwaitingUserInteraction,
    anyRunning,
    coldStartVisible,
    idleAfterVersion,
    version,
    hasLiveSubagent,
    hasRunningAwaitWaitFor,
  });

  useEffect(() => {
    if (
      scoped ||
      !visible ||
      !effectiveSessionId ||
      hasLiveSubagent ||
      anyRunning ||
      hasPendingStreamRetry
    )
      return;
    let timerId: number | null = null;
    let disposed = false;
    const arm = (delayMs: number) => {
      timerId = window.setTimeout(() => {
        void (async () => {
          const rearmDelay = planningWatchdogDelayMs(
            msSinceSessionChannelActivity(effectiveSessionId)
          );
          if (rearmDelay !== null) {
            if (!disposed) arm(rearmDelay);
            return;
          }
          try {
            const backend = await SessionService.getStatus({
              sessionId: effectiveSessionId,
            });
            if (disposed) return;
            const terminal = planningWatchdogTerminalStatus(backend.status);
            if (terminal === null) {
              log.info(
                `[usePlanningIndicator] watchdog: channel silent for ${PLANNING_WATCHDOG_MS}ms, ` +
                  `but backend is ${backend.status}; keeping the turn active`
              );
              arm(PLANNING_WATCHDOG_MS);
              return;
            }
            log.warn(
              `[usePlanningIndicator] watchdog: channel missed terminal status; ` +
                `backend is ${backend.status}, settling UI as ${terminal}`
            );
            setSessionRuntimeStatus({
              sessionId: effectiveSessionId,
              status: terminal,
              source: "planning",
            });
          } catch (error) {
            // A failed probe cannot prove the provider stopped. Preserve the
            // active footer and retry instead of recreating the original lie.
            log.warn(
              "[usePlanningIndicator] watchdog backend probe failed; keeping the turn active",
              error
            );
            if (!disposed) arm(PLANNING_WATCHDOG_MS);
          }
        })();
      }, delayMs);
    };
    arm(PLANNING_WATCHDOG_MS);
    return () => {
      disposed = true;
      if (timerId !== null) window.clearTimeout(timerId);
    };
  }, [
    scoped,
    visible,
    effectiveSessionId,
    hasLiveSubagent,
    anyRunning,
    hasPendingStreamRetry,
    setSessionRuntimeStatus,
  ]);

  const [variantIndex, setVariantIndex] = useState(0);
  const [prevVisible, setPrevVisible] = useState(false);
  if (visible !== prevVisible) {
    setPrevVisible(visible);
    if (visible && !prevVisible) {
      setVariantIndex((current) => current + 1);
    }
  }

  return {
    count: visible ? 1 : 0,
    variantIndex,
  };
}
