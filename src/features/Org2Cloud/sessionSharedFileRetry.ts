import type { Org2CloudAuthState } from "./org2CloudAuthAtom";
import { org2CloudAuthIdentityKey } from "./org2CloudAuthAtom";
import { SharedSessionFileRequestError } from "./sharedSessionFilesClient";

export const SHARED_FILE_RETRY_MS = 5 * 60_000;
export const SHARED_FILE_QUOTA_RETRY_MS = 30 * 60_000;
export const MAX_SHARED_FILE_RETRY_ENTRIES = 256;

interface RetryScope {
  identity: string;
  orgId: string;
  sessionId: string;
}

interface RetryEntry extends Omit<RetryScope, "sessionId"> {
  /** Quota applies to the organization, not just the failing session. */
  sessionId: string | null;
  retryAt: number;
}

export function sharedFileRetryScope(
  auth: Org2CloudAuthState,
  endpointUrl: string,
  orgId: string,
  sessionId: string
): RetryScope {
  return {
    identity: JSON.stringify([org2CloudAuthIdentityKey(auth), endpointUrl]),
    orgId,
    sessionId,
  };
}

/** Owned by the replay sender. Consulted only by existing sync passes: no timers. */
export class SessionSharedFileRetry {
  private readonly entries = new Map<string, RetryEntry>();

  reset(): void {
    this.entries.clear();
  }

  prune(orgs: ReadonlySet<string>, sessions: ReadonlySet<string>): void {
    for (const [key, entry] of this.entries) {
      if (
        entry.retryAt <= Date.now() ||
        !orgs.has(entry.orgId) ||
        (entry.sessionId !== null && !sessions.has(entry.sessionId))
      )
        this.entries.delete(key);
    }
  }

  isBackedOff(scope: RetryScope): boolean {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.retryAt <= now) {
        this.entries.delete(key);
        continue;
      }
      if (
        entry.identity === scope.identity &&
        entry.orgId === scope.orgId &&
        (entry.sessionId === null || entry.sessionId === scope.sessionId)
      )
        return true;
    }
    return false;
  }

  noteFailure(scope: RetryScope, error: unknown): void {
    const quota =
      error instanceof SharedSessionFileRequestError &&
      error.code === "ORG2_QUOTA_EXCEEDED";
    const sessionId = quota ? null : scope.sessionId;
    const key = JSON.stringify([scope.identity, scope.orgId, sessionId]);
    this.entries.delete(key);
    this.entries.set(key, {
      ...scope,
      sessionId,
      retryAt:
        Date.now() +
        (quota ? SHARED_FILE_QUOTA_RETRY_MS : SHARED_FILE_RETRY_MS),
    });
    while (this.entries.size > MAX_SHARED_FILE_RETRY_ENTRIES) {
      this.entries.delete(this.entries.keys().next().value!);
    }
  }
}
