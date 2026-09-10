import { useStore } from "jotai";
import { useEffect } from "react";

import {
  loadStatusAtom,
  transcriptReplaceEpochAtom,
} from "@src/engines/SessionCore/core/atoms/metadata";
import { createLogger } from "@src/hooks/logger";
import { activeSessionIdAtom } from "@src/store/session";
import { isCliSession } from "@src/util/session/sessionDispatch";

import { getTurnGeneration, isTurnActive } from "../control/turnLifecycle";
import {
  shouldWaitForStableTranscript,
  startExternalHistoryRefreshScheduler,
} from "./externalHistoryAutoRefresh";
import { loadNativeConversationRevision } from "./nativeConversationRevision";
import type { NativeHistoryLoadRevision } from "./nativeHistoryLoadRevision";
import { reconcileNativeTranscript } from "./nativeTranscriptReconcile";

const log = createLogger("NativeHistoryAutoRefresh");
const REFRESH_INTERVAL_MS = 30_000;

/** One active session, one revision and one in-flight request; no global cache. */
export function createNativeHistoryRefreshPoll(options: {
  isCurrent: () => boolean;
  generation: () => number;
  readRevision: () => Promise<string | null | undefined>;
  refresh: (signal: AbortSignal, isCurrent: () => boolean) => Promise<unknown>;
  loadedRevision?: () => NativeHistoryLoadRevision | undefined;
  now?: () => number;
}) {
  let appliedRevision: string | undefined;
  const settle = { signature: null as string | null, firstObservedAt: 0 };
  let controller: AbortController | null = null;
  const now = options.now ?? Date.now;
  return {
    abort: () => controller?.abort(),
    async poll() {
      if (controller || !options.isCurrent()) return;
      const request = new AbortController();
      controller = request;
      const generation = options.generation();
      if (!appliedRevision) {
        const loaded = options.loadedRevision?.();
        if (loaded?.generation === generation)
          appliedRevision = loaded.revision;
      }
      const isCurrent = () =>
        !request.signal.aborted &&
        options.isCurrent() &&
        options.generation() === generation;
      try {
        const revision = await options.readRevision();
        if (!isCurrent()) return;
        if (!revision) {
          appliedRevision = undefined;
          settle.signature = null;
          return;
        }
        if (revision === appliedRevision) return;
        if (shouldWaitForStableTranscript(settle, revision, now(), 2_000))
          return;
        await options.refresh(request.signal, isCurrent);
        if (!isCurrent()) return;
        // A provider can append or compact during the read. Only acknowledge
        // the revision we actually observed; a changed file gets another pass.
        if ((await options.readRevision()) === revision && isCurrent()) {
          appliedRevision = revision;
        }
        settle.signature = null;
      } finally {
        if (controller === request) controller = null;
      }
    },
  };
}

/**
 * Native Apps write the provider file without sending ORG2 a lifecycle event.
 * A slow stat-only safety poll catches those writes for the visible managed
 * session. Imported history has its own mutually exclusive scheduler.
 */
export function useNativeHistoryAutoRefresh(
  sessionId: string | null,
  loadedRevision: () => NativeHistoryLoadRevision | undefined
): void {
  const store = useStore();
  useEffect(() => {
    if (!sessionId || !isCliSession(sessionId)) return;
    let disposed = false;
    const refresh = createNativeHistoryRefreshPoll({
      isCurrent: () =>
        !disposed &&
        store.get(activeSessionIdAtom) === sessionId &&
        store.get(loadStatusAtom) === "loaded" &&
        !isTurnActive(sessionId),
      generation: () => getTurnGeneration(sessionId),
      loadedRevision,
      readRevision: () => loadNativeConversationRevision(sessionId),
      refresh: async (signal, isCurrent) => {
        await reconcileNativeTranscript(sessionId, {
          signal,
          refreshGuard: isCurrent,
        });
        if (isCurrent()) {
          store.set(transcriptReplaceEpochAtom, (epoch) => epoch + 1);
        }
      },
    });
    const stop = startExternalHistoryRefreshScheduler({
      foregroundIntervalMs: REFRESH_INTERVAL_MS,
      onHidden: refresh.abort,
      poll: async () => {
        try {
          await refresh.poll();
        } catch (error) {
          if (
            !disposed &&
            !(error instanceof DOMException && error.name === "AbortError")
          ) {
            log.rateLimited(
              `native-refresh-${sessionId}`,
              60_000,
              "Native history refresh deferred",
              error
            );
          }
        }
      },
    });
    return () => {
      disposed = true;
      stop();
      refresh.abort();
    };
  }, [sessionId, store, loadedRevision]);
}
