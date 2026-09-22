/**
 * useCloudSessionActions — big-session play gate + paused-download commit.
 *
 * Big-session play gate: the listing already knows the event count and the
 * device knows its observed download rate. Instead of a blocking modal, the
 * Chat Pane tab opens immediately with a play card (count + ETA) and nothing
 * transfers until the user hits Start. Only the not-yet-covered remainder
 * counts (a cached copy that just needs a delta stays gate-free).
 */
import {
  deriveImportedSessionId,
  findImportedSession,
} from "@src/features/TeamCollaboration/engine/collabSyncEngineHelpers";
import type { RemoteTeammateSessionMetadata } from "@src/store/collaboration/types";
import { sessionsAtom } from "@src/store/session";

import { decideCloudDownloadGate } from "./cloudDownloadEstimator";
import { dismissCloudReferenceOpeningToast } from "./cloudReferenceOpeningToast";
import {
  type CloudPausedDownloadCursor,
  type CloudSessionEnvironmentIdentity,
  type CloudSessionOwnerIdentity,
  cloudSessionPausedDownloadsAtom,
  setCloudDownloadPendingPlayAtom,
  setCloudPausedDownloadAtom,
} from "./cloudSessionDownloadControlAtoms";
import { cloudSessionDownloadProgressAtom } from "./cloudSessionDownloadProgressAtom";
import { buildCloudPendingPlayEntry } from "./cloudSessionReplayLifecycle";
import type { CloudSessionActionDeps } from "./useCloudSessionActions.shared";
import type { CloudSessionReplayOptions } from "./useCloudSessionActions.types";

type GateDeps = Pick<
  CloudSessionActionDeps,
  "store" | "authRef" | "openOrReplaceSessionTab"
>;

/**
 * Replay gate. Every replay import is interactive; the org's
 * background-upload policy affects owner pushes, not downloads.
 *
 * @returns `true` when the row was parked behind a play card (caller returns
 * "noop"); `false` when the transfer may begin.
 */
export async function parkReplayBehindPlayGate(
  deps: GateDeps,
  args: {
    orgId: string;
    remoteSession: RemoteTeammateSessionMetadata;
    requestAuthIdentityKey: string;
    options: CloudSessionReplayOptions | undefined;
  }
): Promise<boolean> {
  const { store, authRef, openOrReplaceSessionTab } = deps;
  const { orgId, remoteSession, requestAuthIdentityKey, options } = args;
  const gateEndpointUrl = authRef.current?.supabaseUrl;
  const gateSession = gateEndpointUrl
    ? findImportedSession(
        store.get(sessionsAtom),
        orgId,
        remoteSession.sourceSessionId,
        gateEndpointUrl
      )
    : undefined;
  const gateCursor = gateSession?.importedFrom;
  const coveredCount =
    gateCursor && gateCursor.epoch === remoteSession.eventsEpoch
      ? gateCursor.count
      : 0;
  const pendingEvents = Math.max(
    0,
    (remoteSession.eventsCount ?? 0) - coveredCount
  );
  const decision = decideCloudDownloadGate(pendingEvents);
  if (decision.gate && gateEndpointUrl) {
    const pendingLocalId =
      gateSession?.session_id ??
      (await deriveImportedSessionId(
        orgId,
        remoteSession.sourceSessionId,
        gateEndpointUrl
      ));
    store.set(setCloudDownloadPendingPlayAtom, {
      localSessionId: pendingLocalId,
      entry: buildCloudPendingPlayEntry({
        remoteSession,
        authIdentityKey: requestAuthIdentityKey,
        orgId,
        pendingEvents,
        etaMs: decision.etaMs,
        kind: "replay",
      }),
    });
    dismissCloudReferenceOpeningToast();
    if (options?.openSurface) {
      options.openSurface({
        localSessionId: pendingLocalId,
        remoteSession,
      });
    } else {
      openOrReplaceSessionTab({
        sessionId: pendingLocalId,
        sessionName: remoteSession.title,
      });
    }
    return true;
  }
  return false;
}

/**
 * Fork gate, replay parity: a Take Over whose pre-import would stream a
 * large transcript parks the same play card (count + ETA) in the imported
 * copy's pane and transfers nothing until Start. A current local copy, a
 * resumable pause, or a small delta stays gate-free — those never surprise
 * with a long transfer.
 *
 * @returns `true` when the row was parked behind a play card (caller returns
 * "noop"); `false` when the fork may proceed.
 */
export async function parkForkBehindPlayGate(
  deps: GateDeps,
  args: {
    orgId: string;
    remoteSession: RemoteTeammateSessionMetadata;
    requestAuthIdentityKey: string;
  }
): Promise<boolean> {
  const { store, authRef, openOrReplaceSessionTab } = deps;
  const { orgId, remoteSession, requestAuthIdentityKey } = args;
  const gateEndpointUrl = authRef.current?.supabaseUrl;
  const pausedGateEntry = store
    .get(cloudSessionPausedDownloadsAtom)
    .get(remoteSession.id);
  if (gateEndpointUrl && !pausedGateEntry) {
    const gateSession = findImportedSession(
      store.get(sessionsAtom),
      orgId,
      remoteSession.sourceSessionId,
      gateEndpointUrl
    );
    const gateCursor = gateSession?.importedFrom;
    const coveredCount =
      gateCursor && gateCursor.epoch === remoteSession.eventsEpoch
        ? gateCursor.count
        : 0;
    const pendingEvents = Math.max(
      0,
      (remoteSession.eventsCount ?? 0) - coveredCount
    );
    const decision = decideCloudDownloadGate(pendingEvents);
    if (decision.gate) {
      const pendingLocalId =
        gateSession?.session_id ??
        (await deriveImportedSessionId(
          orgId,
          remoteSession.sourceSessionId,
          gateEndpointUrl
        ));
      store.set(setCloudDownloadPendingPlayAtom, {
        localSessionId: pendingLocalId,
        entry: buildCloudPendingPlayEntry({
          remoteSession,
          authIdentityKey: requestAuthIdentityKey,
          orgId,
          pendingEvents,
          etaMs: decision.etaMs,
          kind: "fork",
        }),
      });
      openOrReplaceSessionTab({
        sessionId: pendingLocalId,
        sessionName: remoteSession.title,
      });
      return true;
    }
  }
  return false;
}

/**
 * Pause, not cancel: keep the progress entry (flipped to paused) so the card
 * shows the held position with a Resume affordance. The captured cursor lets
 * the next start continue the transfer; without one it simply restreams.
 */
export function commitPausedCloudDownload(
  deps: Pick<CloudSessionActionDeps, "store" | "upsertDownloadProgress">,
  args: {
    orgId: string;
    remoteSession: RemoteTeammateSessionMetadata;
    localSessionId: string;
    requestAuthIdentityKey: string;
    sessionEnvironment: CloudSessionEnvironmentIdentity;
    sessionOwner: CloudSessionOwnerIdentity | undefined;
    captured: CloudPausedDownloadCursor | null;
  }
): void {
  const { store, upsertDownloadProgress } = deps;
  const {
    orgId,
    remoteSession,
    localSessionId,
    requestAuthIdentityKey,
    sessionEnvironment,
    sessionOwner,
    captured,
  } = args;
  const lastProgress = store
    .get(cloudSessionDownloadProgressAtom)
    .get(localSessionId);
  const heldLoaded = lastProgress?.loadedEvents ?? captured?.count ?? 0;
  const heldTotal =
    lastProgress?.totalEvents ?? remoteSession.eventsCount ?? null;
  store.set(setCloudPausedDownloadAtom, {
    rowId: remoteSession.id,
    entry: {
      localSessionId,
      orgId,
      totalEvents: heldTotal,
      loadedEvents: heldLoaded,
      cursor: captured,
    },
  });
  upsertDownloadProgress({
    localSessionId,
    progress: {
      authIdentityKey: requestAuthIdentityKey,
      rowId: remoteSession.id,
      orgId,
      sourceSession: remoteSession,
      sessionEnvironment,
      sessionOwner,
      loadedEvents: heldLoaded,
      totalEvents: heldTotal,
      startedAtMs: lastProgress?.startedAtMs ?? Date.now(),
      updatedAtMs: Date.now(),
      phase: "paused",
    },
  });
}
