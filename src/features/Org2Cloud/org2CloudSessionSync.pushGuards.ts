/**
 * Org2CloudSessionSync — per-(org, session) transient push guards.
 *
 * Two small pieces of bookkeeping the pass orchestration consults before it
 * touches the event plane:
 * - a bounded exponential retry for transient event-plane failures (org
 *   entitlement failures back off elsewhere), and
 * - the shrink confirmation: a persisted read shorter than the cloud cursor
 *   must repeat identically across passes before it is allowed to rewrite.
 */
import { createLogger } from "@src/hooks/logger";

import { isOrg2SyncErrorCode } from "./org2CloudSyncClient";

const log = createLogger("Org2CloudSyncEngine");

/** Per-session transient retry policy (org entitlement failures back off elsewhere). */
export const SESSION_PUSH_RETRY_BASE_MS = 60_000;
export const SESSION_PUSH_RETRY_MAX_MS = 30 * 60_000;

interface SessionPushRetryState {
  failures: number;
  retryAtMs: number;
}

/** Verdict of one shrink observation for a session whose read is short. */
export type SessionShrinkVerdict =
  /** Not a shrink (or no cursor): push normally. */
  | "proceed"
  /** Same short count on consecutive passes: re-anchor via epoch rewrite. */
  | "confirmed"
  /** First observation or a hollow read: skip this pass without pushing. */
  | "skip";

export class Org2CloudSessionPushGuards {
  /** Transient event-plane failures, bounded by live (org, session) pairs. */
  private readonly sessionPushRetryStates = new Map<
    string,
    SessionPushRetryState
  >();

  /** A short read must repeat identically across passes before it rewrites. */
  private readonly sessionShrinkCandidates = new Map<string, number>();

  reset(): void {
    this.sessionPushRetryStates.clear();
    this.sessionShrinkCandidates.clear();
  }

  prune(
    liveOrgIds: ReadonlySet<string>,
    liveSessionIds: ReadonlySet<string>
  ): void {
    for (const states of [
      this.sessionPushRetryStates,
      this.sessionShrinkCandidates,
    ] as const) {
      for (const key of states.keys()) {
        const separatorIndex = key.indexOf(":");
        const orgId =
          separatorIndex === -1 ? key : key.slice(0, separatorIndex);
        const sessionId =
          separatorIndex === -1 ? "" : key.slice(separatorIndex + 1);
        if (!liveOrgIds.has(orgId) || !liveSessionIds.has(sessionId)) {
          states.delete(key);
        }
      }
    }
  }

  isSessionPushBackedOff(orgId: string, sessionId: string): boolean {
    const key = `${orgId}:${sessionId}`;
    const state = this.sessionPushRetryStates.get(key);
    if (!state) return false;
    if (Date.now() < state.retryAtMs) return true;
    return false;
  }

  noteSessionPushFailure(orgId: string, sessionId: string): void {
    const key = `${orgId}:${sessionId}`;
    const previous = this.sessionPushRetryStates.get(key);
    const failures = (previous?.failures ?? 0) + 1;
    const delayMs = Math.min(
      SESSION_PUSH_RETRY_BASE_MS * 2 ** (failures - 1),
      SESSION_PUSH_RETRY_MAX_MS
    );
    this.sessionPushRetryStates.set(key, {
      failures,
      retryAtMs: Date.now() + delayMs,
    });
  }

  clearSessionPushFailure(orgId: string, sessionId: string): void {
    this.sessionPushRetryStates.delete(`${orgId}:${sessionId}`);
  }

  shouldBackOffSessionFailure(error: unknown): boolean {
    // Entitlement failures already have org-wide active/inactive backoff and
    // toast policy in Org2CloudSyncEngine. Duplicating that state here would
    // keep one session asleep after the org is explicitly resumed.
    return (
      !isOrg2SyncErrorCode(error, "ORG2_QUOTA_EXCEEDED") &&
      !isOrg2SyncErrorCode(error, "ORG2_SYNC_DISABLED")
    );
  }

  /**
   * Judge a persisted read against the cloud cursor. `cursorPushedCount` is
   * undefined when the session has no cursor yet (never a shrink).
   */
  observeShrink(
    orgId: string,
    sessionId: string,
    observedTotalEventCount: number,
    cursorPushedCount: number | undefined
  ): SessionShrinkVerdict {
    const shrinkKey = `${orgId}:${sessionId}`;
    if (
      cursorPushedCount !== undefined &&
      observedTotalEventCount < cursorPushedCount
    ) {
      if (observedTotalEventCount === 0) {
        // A hollow local read can NEVER authorize erasing the cloud copy.
        // An empty store (wiped cache, missing provider DB, rebuilding
        // import) reads zero on EVERY pass, so consecutive-pass
        // confirmation is no evidence of intent — and the cloud row may be
        // the only surviving copy (cursoride-93121e8a lost its 301 cloud
        // events to exactly this rewrite on 2026-07-31). Recovery for a
        // hollow local store is seed/import, not an empty rewrite.
        this.sessionShrinkCandidates.delete(shrinkKey);
        log.rateLimited(
          `hollow-push-${shrinkKey}`,
          60_000,
          `persisted read for ${sessionId} returned 0 events but the ` +
            `cloud cursor covers ${cursorPushedCount}; refusing hollow ` +
            `epoch rewrite`
        );
        return "skip";
      }
      if (
        this.sessionShrinkCandidates.get(shrinkKey) === observedTotalEventCount
      ) {
        this.sessionShrinkCandidates.delete(shrinkKey);
        log.info(
          `persisted read for ${sessionId} returned ${observedTotalEventCount} events ` +
            `on consecutive passes while the cloud cursor covers ` +
            `${cursorPushedCount}; re-anchoring via epoch rewrite`
        );
        return "confirmed";
      }
      this.sessionShrinkCandidates.set(shrinkKey, observedTotalEventCount);
      log.warn(
        `persisted read for ${sessionId} returned ${observedTotalEventCount} events ` +
          `but the cloud cursor covers ${cursorPushedCount}; skipping`
      );
      return "skip";
    }
    this.sessionShrinkCandidates.delete(shrinkKey);
    return "proceed";
  }
}
