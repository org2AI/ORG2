/**
 * useCloudSessionActions — read-only replay of a teammate's cloud session.
 *
 * Same shared importer the self-hosted panel row uses, only the
 * segments-fetch client differs. Rows are server-filtered to the retention
 * window, but a click can race past it — ORG2_RETENTION_EXPIRED then
 * surfaces as an upgrade prompt, not a generic failure.
 */
import { useSetAtom } from "jotai";
import { useCallback, useEffect, useRef } from "react";

import Message from "@src/components/Message";
import {
  beginSessionHydrationAtom,
  endSessionHydrationAtom,
  triggerSessionReloadAtom,
} from "@src/engines/SessionCore";
import {
  deriveImportedSessionId,
  findImportedSession,
  importRemoteSession,
} from "@src/features/TeamCollaboration/engine/collabSyncEngineHelpers";
import { resolveForkWorkspacePath } from "@src/features/TeamCollaboration/forkSession";
import { createLogger } from "@src/hooks/logger";
import type { RemoteTeammateSessionMetadata } from "@src/store/collaboration/types";
import { activeSessionIdAtom, sessionsAtom } from "@src/store/session";

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
import {
  completeCloudDownloadProgressWithLinger,
  createThrottledProgressReporter,
} from "./cloudSessionDownloadProgressAtom";
import {
  resolveCloudSessionEnvironmentIdentity,
  resolveCloudSessionOwnerIdentity,
  resolveCloudSessionReplayIconId,
  runImmediateCloudSessionReplay,
} from "./cloudSessionReplayLifecycle";
import { applyCloudTurnSkeleton } from "./cloudSessionTurnSkeleton";
import { org2CloudAuthIdentityKey } from "./org2CloudAuthAtom";
import { buildCloudSessionFetchClient } from "./org2CloudBackendAdapter";
import { isOrg2SyncErrorCode } from "./org2CloudSyncClient";
import {
  commitPausedCloudDownload,
  parkReplayBehindPlayGate,
} from "./useCloudSessionActions.downloadGate";
import type { CloudSessionActionDeps } from "./useCloudSessionActions.shared";
import type {
  CloudSessionActionOutcome,
  CloudSessionReplayOptions,
  UseCloudSessionActionsResult,
} from "./useCloudSessionActions.types";

const log = createLogger("useCloudSessionActions");

export function useCloudSessionReplayAction(
  deps: CloudSessionActionDeps
): UseCloudSessionActionsResult["replaySession"] {
  const {
    orgId,
    t,
    store,
    authRef,
    authIdentityKey,
    freshAccessToken,
    notifyRetentionExpired,
    openOrReplaceSessionTab,
    updateMetadata,
    beginSessionBusy,
    updateSessionBusy,
    endSessionBusy,
    upsertDownloadProgress,
    clearDownloadProgress,
  } = deps;
  const beginSessionHydration = useSetAtom(beginSessionHydrationAtom);
  const endSessionHydration = useSetAtom(endSessionHydrationAtom);
  const triggerSessionReload = useSetAtom(triggerSessionReloadAtom);

  // One controller per in-flight replay row; unmount aborts the
  // fetch/decode/apply instead of merely ignoring the result. A map, not a
  // single slot: rows download concurrently now.
  const replayAbortsRef = useRef(new Map<string, AbortController>());
  useEffect(() => {
    const aborts = replayAbortsRef.current;
    return () => {
      for (const controller of aborts.values()) controller.abort();
      aborts.clear();
    };
  }, [authIdentityKey, orgId]);

  return useCallback(
    async (
      remoteSession: RemoteTeammateSessionMetadata,
      options?: CloudSessionReplayOptions
    ): Promise<CloudSessionActionOutcome> => {
      if (!orgId || remoteSession.eventsEpoch === undefined) return "noop";
      const sessionEnvironment =
        resolveCloudSessionEnvironmentIdentity(remoteSession);
      const sessionOwner = resolveCloudSessionOwnerIdentity(remoteSession);
      const requestAuth = authRef.current;
      if (!requestAuth) return "noop";
      const requestAuthIdentityKey = org2CloudAuthIdentityKey(requestAuth);
      // Store read at call time: the render-captured map can be stale, and
      // both sidebar connectors plus Kanban share this registry. Only the
      // clicked row's own in-flight action blocks it.
      if (store.get(cloudSessionBusyRowsAtom).has(remoteSession.id)) {
        return "noop";
      }
      // A paused download resumes on the next start; it is never re-gated.
      const pausedEntry =
        store.get(cloudSessionPausedDownloadsAtom).get(remoteSession.id) ??
        null;
      // Big-session play gate (see `useCloudSessionActions.downloadGate.ts`).
      if (!pausedEntry && !options?.skipDownloadGate) {
        const gated = await parkReplayBehindPlayGate(
          { store, authRef, openOrReplaceSessionTab },
          { orgId, remoteSession, requestAuthIdentityKey, options }
        );
        if (gated) return "noop";
      }
      if (store.get(cloudSessionBusyRowsAtom).has(remoteSession.id)) {
        return "noop";
      }
      beginSessionBusy({
        rowId: remoteSession.id,
        entry: { kind: "replay", orgId },
      });
      store.set(clearCloudPausedDownloadAtom, remoteSession.id);
      const abortController = new AbortController();
      replayAbortsRef.current.get(remoteSession.id)?.abort();
      replayAbortsRef.current.set(remoteSession.id, abortController);
      registerCloudDownloadAbort(remoteSession.id, () =>
        abortController.abort()
      );
      let localSessionId: string | null = null;
      let pausedCaptured: CloudPausedDownloadCursor | null = null;
      let pausedCommitted = false;
      let completedOk = false;
      let progressReporter: ReturnType<
        typeof createThrottledProgressReporter
      > | null = null;
      try {
        const sourceEndpointUrl = authRef.current?.supabaseUrl;
        if (!sourceEndpointUrl) {
          Message.error(t("cloud.orgPanel.importError"));
          return "failed";
        }
        const existing = findImportedSession(
          store.get(sessionsAtom),
          orgId,
          remoteSession.sourceSessionId,
          sourceEndpointUrl
        );
        localSessionId =
          existing?.session_id ??
          (await deriveImportedSessionId(
            orgId,
            remoteSession.sourceSessionId,
            sourceEndpointUrl
          ));
        // Immutable copy for the closures below (TS cannot narrow the
        // mutable `let` the finally block needs).
        const importSessionId = localSessionId;
        store.set(clearCloudDownloadPendingPlayAtom, importSessionId);
        // A click on this row while the download runs refocuses this tab.
        updateSessionBusy({
          rowId: remoteSession.id,
          patch: { localSessionId: importSessionId },
        });
        // Events already durable before this start: a paused download's
        // persisted pages, or the covered base of an incremental refresh.
        // Progress starts from it and the rate sample must exclude it.
        const baseEvents =
          pausedEntry?.cursor?.count ??
          (existing?.importedFrom &&
          existing.importedFrom.epoch === remoteSession.eventsEpoch
            ? existing.importedFrom.count
            : 0);

        const progressStartedAt = Date.now();
        // Two sources feed one bar: segment-granular decode ticks (fine,
        // during the long storage-object transfer of a 64-segment page)
        // and the importer's post-persist page reports (absolute,
        // including any incremental base). They interleave — keep the
        // bar monotonic with a max-merge. A resumed download starts the
        // bar from the paused position instead of zero.
        let maxLoadedEvents = pausedEntry ? baseEvents : 0;
        const reporter = createThrottledProgressReporter((payload) =>
          upsertDownloadProgress(payload)
        );
        progressReporter = reporter;
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
        // When a transfer is genuinely coming (fresh import, stale cursor,
        // resume), surface the bar in the SAME frame as the click — the
        // token refresh and workspace resolution ahead of the first network
        // tick used to leave a second of dead air. A cursor-current reopen
        // stays silent: seeding it would flash a bar over an instant open.
        const seedCursor = existing?.importedFrom;
        const cursorCurrent =
          !!seedCursor &&
          seedCursor.epoch === remoteSession.eventsEpoch &&
          seedCursor.seq === (remoteSession.eventsFrozenSeq ?? 0) &&
          seedCursor.count === remoteSession.eventsCount &&
          (seedCursor.tailHash ?? null) ===
            (remoteSession.eventsTailHash ?? null);
        if (!cursorCurrent) {
          reportDownloadProgress(
            baseEvents,
            remoteSession.eventsCount ?? pausedEntry?.totalEvents ?? null
          );
        }

        let localRepoPath: string | undefined;
        const result = await runImmediateCloudSessionReplay({
          sessionId: importSessionId,
          beginHydration: (sessionId) =>
            beginSessionHydration({
              sessionId,
              iconId: resolveCloudSessionReplayIconId(remoteSession),
            }),
          openTab: (sessionId) => {
            if (options?.openSurface) {
              options.openSurface({
                localSessionId: sessionId,
                remoteSession,
              });
              return;
            }
            openOrReplaceSessionTab({
              sessionId,
              sessionName: remoteSession.title,
            });
          },
          load: async () => {
            const accessToken = await freshAccessToken();
            abortController.signal.throwIfAborted();
            if (!accessToken) return null;
            // Round-first skeleton (0012): for a fresh import, fetch the
            // owner-published turn index IN PARALLEL with the download and
            // render every round (prompt + placeholder) immediately. Guarded
            // so a fast import that already hydrated the real initial window
            // is never shadowed by a late skeleton write.
            let importSettled = false;
            if (!existing) {
              applyCloudTurnSkeleton({
                accessToken,
                orgId,
                remoteSession,
                localSessionId: importSessionId,
                signal: abortController.signal,
                shouldApply: () => !importSettled,
              }).catch((error: unknown) => {
                // applyCloudTurnSkeleton settles every failure internally;
                // this handler only keeps the parallel fetch from floating.
                log.warn("cloud turn skeleton rejected unexpectedly", error);
              });
            }
            // Resolve after opening so checkout discovery cannot delay the
            // Chat Pane tab. The path later restores local tab metadata and
            // feeds the derived blame index.
            localRepoPath =
              (await resolveForkWorkspacePath(remoteSession)) ?? undefined;
            abortController.signal.throwIfAborted();
            const importPromise = importRemoteSession({
              client: buildCloudSessionFetchClient(accessToken, undefined, {
                onTransferProgress: (progress) =>
                  reportDownloadProgress(
                    // Decode ticks count THIS transfer only; rebase them so
                    // a resumed bar keeps describing the whole session.
                    baseEvents + progress.decodedEvents,
                    progress.totalEvents
                  ),
              }),
              orgId,
              remoteSession,
              sourceEndpointUrl,
              workspaceRepoPath: localRepoPath,
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
            try {
              const result = await importPromise;
              // Feed the device's rate estimator so the next play card
              // quotes a realistic ETA. Only the events THIS transfer moved
              // count — sampling the absolute total against a delta's
              // elapsed time would inflate the rate device-wide.
              if (result?.updated && maxLoadedEvents > baseEvents) {
                recordCloudDownloadSample(
                  maxLoadedEvents - baseEvents,
                  Date.now() - progressStartedAt
                );
              }
              return result;
            } finally {
              importSettled = true;
            }
          },
          endHydration: endSessionHydration,
        });
        if (result) {
          if (result.localSessionId !== importSessionId) {
            log.warn("cloud replay resolved a different local session id", {
              expected: importSessionId,
              actual: result.localSessionId,
              sourceSessionId: remoteSession.sourceSessionId,
            });
          }
          // Do not navigate here: the user may have left or closed the tab
          // while the network request was running. Reload only the still-live
          // surface; inactive sessions read the persisted cache when reopened.
          if (store.get(activeSessionIdAtom) === result.localSessionId) {
            updateMetadata({ repoPath: localRepoPath });
            triggerSessionReload(result.localSessionId);
          }
          completedOk = true;
          return "opened";
        }
        // null ⇒ owner has published no segments (metadata-only card).
        Message.error(t("cloud.orgPanel.importError"));
        return "failed";
      } catch (error) {
        if (abortController.signal.aborted) {
          // Pause, not cancel: keep the progress entry (flipped to paused)
          // so the card shows the held position with a Resume affordance.
          // (Widened reads below: TS control-flow ignores the closure
          // assignments.)
          (
            progressReporter as ReturnType<
              typeof createThrottledProgressReporter
            > | null
          )?.cancel();
          if (localSessionId) {
            commitPausedCloudDownload(
              { store, upsertDownloadProgress },
              {
                orgId,
                remoteSession,
                localSessionId,
                requestAuthIdentityKey,
                sessionEnvironment,
                sessionOwner,
                // Widened read: TS control-flow ignores the closure assignment.
                captured: pausedCaptured as CloudPausedDownloadCursor | null,
              }
            );
            pausedCommitted = true;
          }
          return "noop";
        }
        if (isOrg2SyncErrorCode(error, "ORG2_RETENTION_EXPIRED")) {
          notifyRetentionExpired();
          return "retention-expired";
        }
        // Listing said replayable but the read raced a sharing-level /
        // floor change — name the reason instead of the generic toast.
        if (isOrg2SyncErrorCode(error, "ORG2_REPLAY_NOT_AVAILABLE")) {
          Message.error(t("cloud.sidebar.metadataOnly"));
          return "failed";
        }
        log.error("cloud session replay failed", error);
        Message.error(t("cloud.orgPanel.importError"));
        return "failed";
      } finally {
        if (replayAbortsRef.current.get(remoteSession.id) === abortController) {
          replayAbortsRef.current.delete(remoteSession.id);
        }
        unregisterCloudDownloadAbort(remoteSession.id);
        endSessionBusy(remoteSession.id);
        // A parked trailing tick must never resurrect the entry this
        // teardown clears (or overwrite the paused state it just wrote).
        (
          progressReporter as ReturnType<
            typeof createThrottledProgressReporter
          > | null
        )?.cancel();
        if (localSessionId && !pausedCommitted) {
          if (completedOk) {
            // Success holds a terminal "completed · 100%" card until the
            // surface has been visible for the minimum window — a sub-second
            // transfer used to flash and vanish like a glitch.
            completeCloudDownloadProgressWithLinger(store, localSessionId);
          } else {
            clearDownloadProgress(localSessionId);
          }
        }
      }
    },
    [
      authRef,
      beginSessionBusy,
      beginSessionHydration,
      clearDownloadProgress,
      endSessionBusy,
      endSessionHydration,
      freshAccessToken,
      openOrReplaceSessionTab,
      notifyRetentionExpired,
      orgId,
      store,
      t,
      triggerSessionReload,
      updateMetadata,
      updateSessionBusy,
      upsertDownloadProgress,
    ]
  );
}
