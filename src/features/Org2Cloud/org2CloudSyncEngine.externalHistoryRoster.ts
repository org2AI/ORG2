/**
 * Org2CloudSyncEngine — imported-history roster activity capture.
 *
 * Imported providers refresh sessionsAtom directly instead of writing the
 * EventStore. Convert only meaningful source-version changes into the same
 * bounded quiet-window trigger used by native event notifications.
 */
import { sessionsAtom } from "@src/store/session/sessionAtom/atoms";
import { isImportedHistorySession } from "@src/util/session/sessionDispatch";

import { isCloudPushCandidate } from "./org2CloudSessionSync";
import type { CloudStore } from "./org2CloudSyncLifecycle";

export interface ExternalHistoryRosterHooks {
  noteSessionEventActivity: (sessionId: string) => void;
  scheduleActivityPass: (sessionId: string) => void;
}

export class Org2CloudExternalHistoryRoster {
  /** Last roster version for each locally owned external-history session. */
  private readonly versions = new Map<string, string>();
  private initialized = false;

  reset(): void {
    this.versions.clear();
    this.initialized = false;
  }

  capture(store: CloudStore, hooks: ExternalHistoryRosterHooks): void {
    const shouldNotifyChanges = this.initialized;
    const nextVersions = new Map<string, string>();
    const changedSessionIds: string[] = [];
    for (const session of store.get(sessionsAtom)) {
      if (
        !isImportedHistorySession(session.session_id) ||
        !isCloudPushCandidate(session)
      ) {
        continue;
      }
      const version = session.updated_at ?? "";
      nextVersions.set(session.session_id, version);
      if (this.versions.get(session.session_id) !== version) {
        changedSessionIds.push(session.session_id);
      }
    }
    this.versions.clear();
    for (const [sessionId, version] of nextVersions) {
      this.versions.set(sessionId, version);
    }
    this.initialized = true;
    // Bootstrap already schedules the authoritative first pass. Treating the
    // initial roster as fresh activity added a redundant 30-second replay.
    if (!shouldNotifyChanges) return;
    if (changedSessionIds.length === 0) return;
    for (const sessionId of changedSessionIds) {
      hooks.noteSessionEventActivity(sessionId);
    }
    // One timer coalesces every changed imported session into one cloud pass.
    hooks.scheduleActivityPass(changedSessionIds[0]!);
  }
}
