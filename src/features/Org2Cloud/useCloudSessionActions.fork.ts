/**
 * useCloudSessionActions — fork & continue a teammate's cloud session.
 *
 * Same full relay as the self-hosted ⑂ row action — engine fork + backend
 * row registration + first-send context handoff. Local-copy-first parity: a
 * Take Over of a session without a CURRENT local replay copy first runs the
 * standard streamed import (same sidebar spinner/percent, same pause/resume
 * semantics), and the fork then assembles from the local copy without a
 * second download.
 */
import { useCallback } from "react";

import Message from "@src/components/Message";
import {
  deriveImportedSessionId,
  findImportedSession,
  importRemoteSession,
} from "@src/features/TeamCollaboration/engine/collabSyncEngineHelpers";
import {
  ForkCancelledError,
  forkTeammateSession,
} from "@src/features/TeamCollaboration/forkSession";
import { classifyForkOperationError } from "@src/features/TeamCollaboration/forkSnapshotIntegrity";
import { createLogger } from "@src/hooks/logger";
import type { RemoteTeammateSessionMetadata } from "@src/store/collaboration/types";
import { sessionsAtom } from "@src/store/session";

import { recordCloudDownloadSample } from "./cloudDownloadEstimator";
import { cloudSessionBusyRowsAtom } from "./cloudSessionBusyAtom";
import {
  registerCloudDownloadAbort,
  unregisterCloudDownloadAbort,
} from "./cloudSessionDownloadAbortRegistry";
import {
  type CloudPausedDownloadCursor,
  clearCloudDownloadPendingPlayAtom,
  clearCloudPausedDownloadAtom,
  cloudSessionPausedDownloadsAtom,
} from "./cloudSessionDownloadControlAtoms";
import { createThrottledProgressReporter } from "./cloudSessionDownloadProgressAtom";
import {
  resolveCloudSessionEnvironmentIdentity,
  resolveCloudSessionOwnerIdentity,
} from "./cloudSessionReplayLifecycle";
import { org2CloudAuthIdentityKey } from "./org2CloudAuthAtom";
import { buildCloudSessionFetchClient } from "./org2CloudBackendAdapter";
import { isOrg2SyncErrorCode } from "./org2CloudSyncClient";
import {
  commitPausedCloudDownload,
  parkForkBehindPlayGate,
} from "./useCloudSessionActions.downloadGate";
import type { CloudSessionActionDeps } from "./useCloudSessionActions.shared";
import type {
  CloudSessionActionOutcome,
  CloudSessionForkOptions,
  UseCloudSessionActionsResult,
} from "./useCloudSessionActions.types";

const log = createLogger("useCloudSessionActions");

export function useCloudSessionForkAction(
  deps: CloudSessionActionDeps
): UseCloudSessionActionsResult["forkSession"] {
  const {
    orgId,
    t,
    store,
    authRef,
    freshAccessToken,
    notifyRetentionExpired,
    openOrReplaceSessionTab,
    openSession,
    beginSessionBusy,
    updateSessionBusy,
    endSessionBusy,
    upsertDownloadProgress,
    clearDownloadProgress,
  } = deps;

  return useCallback(
    async (
      remoteSession: RemoteTeammateSessionMetadata,
      options?: CloudSessionForkOptions
    ): Promise<CloudSessionActionOutcome> => {
      if (!orgId || remoteSession.eventsEpoch === undefined) return "noop";
      const sessionEnvironment =
        resolveCloudSessionEnvironmentIdentity(remoteSession);
      const sessionOwner = resolveCloudSessionOwnerIdentity(remoteSession);
      const requestAuth = authRef.current;
      if (!requestAuth) return "noop";
      const requestAuthIdentityKey = org2CloudAuthIdentityKey(requestAuth);
      if (store.get(cloudSessionBusyRowsAtom).has(remoteSession.id)) {
        return "noop";
      }
      // Big-session gate, replay parity (see
      // `useCloudSessionActions.downloadGate.ts`).
      if (!options?.skipDownloadGate) {
        const gated = await parkForkBehindPlayGate(
          { store, authRef, openOrReplaceSessionTab },
          { orgId, remoteSession, requestAuthIdentityKey }
        );
        if (gated) return "noop";
      }
      beginSessionBusy({
        rowId: remoteSession.id,
        entry: { kind: "fork", orgId },
      });
      let forkPausedCommitted = false;
      try {
        const accessToken = await freshAccessToken();
        if (!accessToken) {
          Message.error(t("collaboration.session.forkFailed"));
          return "failed";
        }
        // Local-copy-first parity: a Take Over of a session without a
        // CURRENT local replay copy first runs the standard streamed import
        // — same sidebar spinner/percent, same pause/resume semantics, and
        // the fork then assembles from the local copy without a second
        // download. An already-imported current copy makes this pre-step a
        // no-op.
        const sourceEndpointUrl = authRef.current?.supabaseUrl;
        if (sourceEndpointUrl) {
          const existing = findImportedSession(
            store.get(sessionsAtom),
            orgId,
            remoteSession.sourceSessionId,
            sourceEndpointUrl
          );
          const cursor = existing?.importedFrom;
          const cursorCurrent =
            !!cursor &&
            cursor.epoch === remoteSession.eventsEpoch &&
            cursor.seq === (remoteSession.eventsFrozenSeq ?? 0) &&
            cursor.count === remoteSession.eventsCount &&
            (cursor.tailHash ?? null) ===
              (remoteSession.eventsTailHash ?? null);
          if (!cursorCurrent) {
            const pausedEntry =
              store
                .get(cloudSessionPausedDownloadsAtom)
                .get(remoteSession.id) ?? null;
            store.set(clearCloudPausedDownloadAtom, remoteSession.id);
            const abortController = new AbortController();
            registerCloudDownloadAbort(remoteSession.id, () =>
              abortController.abort()
            );
            const importSessionId =
              existing?.session_id ??
              (await deriveImportedSessionId(
                orgId,
                remoteSession.sourceSessionId,
                sourceEndpointUrl
              ));
            store.set(clearCloudDownloadPendingPlayAtom, importSessionId);
            updateSessionBusy({
              rowId: remoteSession.id,
              patch: { localSessionId: importSessionId },
            });
            const baseEvents =
              pausedEntry?.cursor?.count ??
              (cursor && cursor.epoch === remoteSession.eventsEpoch
                ? cursor.count
                : 0);
            const progressStartedAt = Date.now();
            let maxLoadedEvents = pausedEntry ? baseEvents : 0;
            const reporter = createThrottledProgressReporter((payload) =>
              upsertDownloadProgress(payload)
            );
            const reportDownloadProgress = (
              loadedEvents: number,
              totalEvents: number | null,
              phase: "downloading" | "finalizing" = "downloading"
            ) => {
              maxLoadedEvents = Math.max(maxLoadedEvents, loadedEvents);
              reporter.report({
                localSessionId: importSessionId,
                progress: {
                  authIdentityKey: requestAuthIdentityKey,
                  rowId: remoteSession.id,
                  orgId,
                  sourceSession: remoteSession,
                  sessionEnvironment,
                  sessionOwner,
                  loadedEvents: maxLoadedEvents,
                  totalEvents,
                  baseEvents,
                  startedAtMs: progressStartedAt,
                  updatedAtMs: Date.now(),
                  phase,
                },
              });
            };
            reportDownloadProgress(
              baseEvents,
              remoteSession.eventsCount ?? pausedEntry?.totalEvents ?? null
            );
            let pausedCaptured: CloudPausedDownloadCursor | null = null;
            try {
              const imported = await importRemoteSession({
                client: buildCloudSessionFetchClient(accessToken, undefined, {
                  onTransferProgress: (progress) =>
                    reportDownloadProgress(
                      baseEvents + progress.decodedEvents,
                      progress.totalEvents
                    ),
                }),
                orgId,
                remoteSession,
                sourceEndpointUrl,
                signal: abortController.signal,
                onProgress: (progress) =>
                  reportDownloadProgress(
                    progress.loadedEvents,
                    progress.totalEvents,
                    progress.phase ?? "downloading"
                  ),
                onPauseState: (state) => {
                  pausedCaptured = state;
                },
                ...(pausedEntry?.cursor
                  ? { resumeCursor: pausedEntry.cursor }
                  : {}),
              });
              if (imported?.updated && maxLoadedEvents > baseEvents) {
                recordCloudDownloadSample(
                  maxLoadedEvents - baseEvents,
                  Date.now() - progressStartedAt
                );
              }
            } catch (error) {
              if (abortController.signal.aborted) {
                commitPausedCloudDownload(
                  { store, upsertDownloadProgress },
                  {
                    orgId,
                    remoteSession,
                    localSessionId: importSessionId,
                    requestAuthIdentityKey,
                    sessionEnvironment,
                    sessionOwner,
                    captured:
                      pausedCaptured as CloudPausedDownloadCursor | null,
                  }
                );
                forkPausedCommitted = true;
                return "noop";
              }
              throw error;
            } finally {
              unregisterCloudDownloadAbort(remoteSession.id);
              reporter.cancel();
              if (!forkPausedCommitted) {
                clearDownloadProgress(importSessionId);
              }
            }
          }
        }
        const result = await forkTeammateSession({
          client: buildCloudSessionFetchClient(accessToken),
          orgId,
          remoteSession,
          ...(sourceEndpointUrl ? { sourceEndpointUrl } : {}),
          promptForExecution: true,
        });
        if (!result) {
          Message.error(t("collaboration.session.forkFailed"));
          return "failed";
        }
        Message.success(
          t("collaboration.session.forkedFromLabel", {
            name: remoteSession.ownerDisplayName,
          })
        );
        // result.repoPath is the RESOLVED local checkout (or undefined when
        // none exists here) — never the owner's absolute path.
        openOrReplaceSessionTab({
          sessionId: result.localSessionId,
          sessionName: result.name,
          repoPath: result.repoPath,
        });
        openSession(result.localSessionId, result.name, result.repoPath);
        return "opened";
      } catch (error) {
        if (error instanceof ForkCancelledError) {
          // User dismissed the mandatory pick-your-checkout dialog (or the
          // picked folder didn't match the source repo) — quiet cancel.
          return "noop";
        }
        if (isOrg2SyncErrorCode(error, "ORG2_RETENTION_EXPIRED")) {
          notifyRetentionExpired();
          return "retention-expired";
        }
        if (isOrg2SyncErrorCode(error, "ORG2_REPLAY_NOT_AVAILABLE")) {
          Message.error(t("cloud.sidebar.metadataOnly"));
          return "failed";
        }
        const forkErrorKind = classifyForkOperationError(error);
        log.error("cloud session fork failed", {
          sourceSessionId: remoteSession.sourceSessionId,
          orgId,
          stage: forkErrorKind ?? "unknown",
          error,
        });
        Message.error(
          t(
            forkErrorKind === "replay_unavailable"
              ? "collaboration.session.forkReplayUnavailable"
              : forkErrorKind === "snapshot_incomplete"
                ? "collaboration.session.forkSnapshotIncomplete"
                : forkErrorKind === "agent_unavailable"
                  ? "collaboration.session.forkAgentUnavailable"
                  : forkErrorKind === "backend_registration"
                    ? "collaboration.session.forkBackendRegistrationFailed"
                    : "collaboration.session.forkFailed"
          )
        );
        return "failed";
      } finally {
        endSessionBusy(remoteSession.id);
      }
    },
    [
      authRef,
      beginSessionBusy,
      clearDownloadProgress,
      endSessionBusy,
      freshAccessToken,
      openOrReplaceSessionTab,
      openSession,
      notifyRetentionExpired,
      orgId,
      store,
      t,
      updateSessionBusy,
      upsertDownloadProgress,
    ]
  );
}
