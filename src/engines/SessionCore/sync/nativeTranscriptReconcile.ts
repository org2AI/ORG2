/**
 * Post-turn reconcile for native-transcript CLI sessions.
 *
 * Native-mode sessions stream ephemeral (in-memory only) events during a
 * turn; the transcript of record is the CLI's own store, read back through
 * `cli_agent_chunks` (which routes to the imported-history loaders). When a
 * turn reaches a terminal status we reload once after a short settle delay
 * so the in-memory events are replaced by the canonical parse, and retry
 * once more in case the CLI flushed its store slightly after exiting.
 *
 * The registry is populated by the CLI adapter's postLoad (from
 * `cli_agent_status.transcriptSource`); legacy sessions never reconcile.
 */
import type { SessionEvent } from "@src/engines/SessionCore/core/types";

const transcriptSourceBySession = new Map<string, string>();

const RECONCILE_SETTLE_MS = 600;
const RECONCILE_RETRY_MS = 2000;

export function registerSessionTranscriptSource(
  sessionId: string,
  transcriptSource: string | undefined
): void {
  if (transcriptSource) {
    transcriptSourceBySession.set(sessionId, transcriptSource);
  }
}

export function isNativeTranscriptSession(sessionId: string): boolean {
  return transcriptSourceBySession.get(sessionId) === "native";
}

interface ReconcileDeps {
  loadHistory: (sessionId: string) => Promise<SessionEvent[]>;
  /** Durable in-app projection captured before native replay replaces it. */
  loadProjectedHistory?: (sessionId: string) => Promise<SessionEvent[]>;
  /** Provider-portable suffix merge supplied by the conversation layer. */
  mergeInterruptedProjection?: (
    nativeEvents: readonly SessionEvent[],
    projectedEvents: readonly SessionEvent[]
  ) => SessionEvent[];
  dispatchLoadSession: (payload: {
    sessionId: string;
    events: SessionEvent[];
    /**
     * The native replay IS the canonical transcript: loadSessionAtom must
     * replace the in-memory turn events (synthetic user bubble, streamed
     * placeholders) instead of merging next to them — their ids never match
     * the replayed rows, so a merge renders every turn twice.
     */
    replace?: boolean;
  }) => void;
  /** The session still on screen? Stale reconciles are dropped. */
  isSessionLive: (sessionId: string) => boolean;
}

interface ReconcileOptions {
  /** Preserve an accepted safe suffix after cancellation/failure. */
  preserveInterruptedSuffix?: boolean;
}

const pendingReconciles = new Set<string>();

function mergeReconcileEvents(
  deps: ReconcileDeps,
  nativeEvents: SessionEvent[],
  projectedEvents: SessionEvent[]
): SessionEvent[] {
  if (projectedEvents.length === 0 || !deps.mergeInterruptedProjection) {
    return nativeEvents;
  }
  return deps.mergeInterruptedProjection(nativeEvents, projectedEvents);
}

export function scheduleNativeTranscriptReconcile(
  sessionId: string,
  deps: ReconcileDeps,
  options: ReconcileOptions = {}
): void {
  if (!isNativeTranscriptSession(sessionId)) return;
  if (pendingReconciles.has(sessionId)) return;
  pendingReconciles.add(sessionId);

  // Capture the durable pre-reconcile projection at most once. Completed
  // turns need no fallback read at all; cancellation/failure is the only path
  // where a killed CLI may not have flushed its newest native fork.
  let projectedHistoryPromise: Promise<SessionEvent[]> | null = null;
  const loadProjectedHistory = (): Promise<SessionEvent[]> => {
    if (!options.preserveInterruptedSuffix || !deps.loadProjectedHistory) {
      return Promise.resolve([]);
    }
    projectedHistoryPromise ??= deps
      .loadProjectedHistory(sessionId)
      .catch(() => []);
    return projectedHistoryPromise;
  };

  const runOnce = async (): Promise<number> => {
    if (!deps.isSessionLive(sessionId)) return -1;
    const [nativeEvents, projectedEvents] = await Promise.all([
      deps.loadHistory(sessionId),
      loadProjectedHistory(),
    ]);
    if (!deps.isSessionLive(sessionId)) return -1;
    const events = mergeReconcileEvents(deps, nativeEvents, projectedEvents);
    if (events.length > 0) {
      deps.dispatchLoadSession({ sessionId, events, replace: true });
    }
    return events.length;
  };

  void (async () => {
    try {
      await new Promise((resolve) => setTimeout(resolve, RECONCILE_SETTLE_MS));
      const firstCount = await runOnce();
      if (firstCount < 0) return;
      // One retry catches a store flushed slightly after process exit; only
      // re-dispatch when the parse actually grew (no pointless flicker).
      await new Promise((resolve) => setTimeout(resolve, RECONCILE_RETRY_MS));
      if (!deps.isSessionLive(sessionId)) return;
      const [nativeEvents, projectedEvents] = await Promise.all([
        deps.loadHistory(sessionId),
        loadProjectedHistory(),
      ]);
      const events = mergeReconcileEvents(deps, nativeEvents, projectedEvents);
      if (
        events.length > Math.max(firstCount, 0) &&
        deps.isSessionLive(sessionId)
      ) {
        deps.dispatchLoadSession({ sessionId, events, replace: true });
      }
    } catch {
      // Best-effort: the ephemeral in-memory events remain on screen; the
      // next session open replays from the native store anyway.
    } finally {
      pendingReconciles.delete(sessionId);
    }
  })();
}
