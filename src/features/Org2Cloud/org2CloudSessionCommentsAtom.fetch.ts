/**
 * The list/claim/merge loop behind `useSessionComments` (see
 * `org2CloudSessionCommentsAtom.ts`): one `fetchComments` callback that
 * claims the entry atomically, pulls a full or delta listing, merges it, and
 * replays any force that queued behind the in-flight fetch.
 */
import type { MutableRefObject } from "react";
import { useCallback } from "react";

import { createLogger } from "@src/hooks/logger";

import {
  type Org2CloudAuthState,
  org2CloudAuthIdentityKey,
} from "./org2CloudAuthAtom";
import { sessionCommentsKey } from "./org2CloudCommentsBus";
import { listSessionComments } from "./org2CloudCommentsClient";
import {
  EMPTY_ENTRY,
  decideSessionCommentsFetch,
  mergeDeltaSessionComments,
  mergeFullSessionComments,
  sessionCommentsDeltaSince,
  shouldEvictSessionCommentsOnError,
  writeSessionCommentsEntry,
} from "./org2CloudSessionCommentsAtom.commentTransforms";
import {
  activeForceTokenByKey,
  completedForceTokenByKey,
  dropPendingForce,
  pendingForceRefetchKeys,
  pendingForceTokenByKey,
  rememberCompletedForceToken,
} from "./org2CloudSessionCommentsAtom.forceTokenTracker";
import type { CloudSessionCommentsEntry } from "./org2CloudSessionCommentsAtom.types";

const log = createLogger("Org2CloudSessionComments");

export type SessionCommentsEntriesUpdater = (
  update: (
    previous: Record<string, CloudSessionCommentsEntry>
  ) => Record<string, CloudSessionCommentsEntry>
) => void;

export type FetchSessionComments = (
  targetOrgId: string,
  targetSessionId: string,
  options?: { force?: boolean; forceToken?: string }
) => Promise<void>;

export function useSessionCommentsFetcher(input: {
  authIdentityKey: string | null;
  authRef: MutableRefObject<Org2CloudAuthState | null>;
  setEntries: SessionCommentsEntriesUpdater;
  withFreshToken: () => Promise<string>;
}): FetchSessionComments {
  const { authIdentityKey, authRef, setEntries, withFreshToken } = input;
  return useCallback(
    async (
      targetOrgId: string,
      targetSessionId: string,
      options?: { force?: boolean; forceToken?: string }
    ): Promise<void> => {
      const targetKey = sessionCommentsKey(targetOrgId, targetSessionId);
      const requestIdentityKey = authIdentityKey;
      if (!requestIdentityKey) return;
      const requestKey = `${requestIdentityKey}\u001f${targetKey}`;
      let force = Boolean(options?.force);
      let forceToken = options?.forceToken;
      if (
        forceToken &&
        (activeForceTokenByKey.get(requestKey) === forceToken ||
          pendingForceTokenByKey.get(requestKey) === forceToken ||
          completedForceTokenByKey.get(requestKey) === forceToken)
      ) {
        return;
      }
      for (;;) {
        // Atomic claim: decide-and-mark in ONE updater against live store
        // state. Two hook instances mounting in the same commit both call in
        // here, but only the first updater run sees a non-loading entry.
        // Snapshot the ids known at claim time so the post-fetch merge can
        // tell an optimistic insert (added DURING the fetch — absent here)
        // from a row the server dropped (present here, missing from the
        // response) and must therefore evict.
        let claimed = false;
        let queuedForce = false;
        let knownIdsAtStart = new Set<string>();
        let anchorAtStart: string | undefined;
        setEntries((previous) => {
          const stored = previous[targetKey];
          const entry =
            stored?.identityKey === requestIdentityKey ? stored : undefined;
          const decision = decideSessionCommentsFetch(entry, force, Date.now());
          if (decision !== "claim") {
            // A force behind an in-flight fetch is QUEUED, never dropped:
            // the running fetch's snapshot may predate the write this force
            // is meant to surface (terminal task states would stay stale
            // forever otherwise — nothing else refetches the embed).
            queuedForce = decision === "queue_force";
            return previous;
          }
          claimed = true;
          knownIdsAtStart = new Set(
            (entry?.comments ?? []).map((comment) => comment.id)
          );
          anchorAtStart = entry?.lastServerTime;
          return writeSessionCommentsEntry(previous, targetKey, {
            ...(entry ?? EMPTY_ENTRY),
            identityKey: requestIdentityKey,
            state: "loading",
          });
        });
        if (!claimed) {
          if (queuedForce) {
            if (forceToken) {
              pendingForceTokenByKey.set(requestKey, forceToken);
            } else {
              pendingForceRefetchKeys.add(requestKey);
            }
          }
          return;
        }
        if (forceToken) activeForceTokenByKey.set(requestKey, forceToken);
        try {
          const accessToken = await withFreshToken();
          const currentAuth = authRef.current;
          if (
            !currentAuth ||
            org2CloudAuthIdentityKey(currentAuth) !== requestIdentityKey
          ) {
            dropPendingForce(requestKey);
            return;
          }
          // Force paths (manual refresh, session-signal tokens, the
          // SUBSCRIBED-edge recovery) stay FULL listings — a full snapshot
          // is the only read that reconciles the stamp-free un-resolve.
          // TTL/org-signal refetches pull the delta behind the stored anchor.
          const since =
            !force && anchorAtStart !== undefined
              ? sessionCommentsDeltaSince(anchorAtStart)
              : undefined;
          const listing = await listSessionComments(
            accessToken,
            targetOrgId,
            targetSessionId,
            since !== undefined ? { since } : undefined
          );
          const latestAfterFetch = authRef.current;
          if (
            !latestAfterFetch ||
            org2CloudAuthIdentityKey(latestAfterFetch) !== requestIdentityKey
          ) {
            dropPendingForce(requestKey);
            return;
          }
          // MERGE, not wholesale-replace — see mergeFullSessionComments /
          // mergeDeltaSessionComments for the two paths' invariants. The
          // fallback-aware `appliedSince` (not the requested `since`) picks
          // the path: a pre-delta backend answers every request in full.
          setEntries((previous) => {
            const latestAuth = authRef.current;
            if (
              !latestAuth ||
              org2CloudAuthIdentityKey(latestAuth) !== requestIdentityKey
            ) {
              return previous;
            }
            const stored = previous[targetKey];
            const sameIdentity = stored?.identityKey === requestIdentityKey;
            const existing = sameIdentity ? stored.comments : [];
            const merged =
              listing.appliedSince !== undefined
                ? mergeDeltaSessionComments(existing, listing.comments)
                : mergeFullSessionComments(
                    existing,
                    listing.comments,
                    knownIdsAtStart
                  );
            const lastServerTime =
              listing.serverTime ??
              (sameIdentity ? stored.lastServerTime : undefined);
            return writeSessionCommentsEntry(previous, targetKey, {
              identityKey: requestIdentityKey,
              comments: merged,
              viewerOwnsSession: listing.viewerOwnsSession,
              state: "ready",
              fetchedAt: Date.now(),
              ...(lastServerTime !== undefined ? { lastServerTime } : {}),
            });
          });
        } catch (error) {
          const latestAuth = authRef.current;
          if (
            !latestAuth ||
            org2CloudAuthIdentityKey(latestAuth) !== requestIdentityKey
          ) {
            dropPendingForce(requestKey);
            return;
          }
          log.warn(
            `cloud_list_session_comments failed for ${targetKey}:`,
            error
          );
          // Visibility revocation EVICTS the cached bodies (0002 invariant
          // 5 for already-cached data); transient failures keep them.
          const evict = shouldEvictSessionCommentsOnError(error);
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          setEntries((previous) => {
            const stored = previous[targetKey];
            const sameIdentity = stored?.identityKey === requestIdentityKey;
            const retained = !evict && sameIdentity ? stored : undefined;
            // Eviction protects cached BODIES, not the failure bookkeeping:
            // resetting the counter on evict-class errors (e.g. a session
            // that is not on the server) would turn the exponential retry
            // back into a flat loop against a persistently failing target.
            const priorFailures = sameIdentity
              ? (stored?.consecutiveFailures ?? 0)
              : 0;
            return writeSessionCommentsEntry(previous, targetKey, {
              ...(retained ?? EMPTY_ENTRY),
              identityKey: requestIdentityKey,
              state: "error",
              errorMessage,
              consecutiveFailures: priorFailures + 1,
              fetchedAt: Date.now(),
            });
          });
        } finally {
          if (forceToken) {
            if (activeForceTokenByKey.get(requestKey) === forceToken) {
              activeForceTokenByKey.delete(requestKey);
            }
            rememberCompletedForceToken(requestKey, forceToken);
          }
        }
        // A force that arrived while THIS fetch was in flight replays as
        // exactly one more forced round-trip. Signal tokens additionally
        // collapse identical requests from multiple mounted subscribers.
        const queuedToken = pendingForceTokenByKey.get(requestKey);
        if (queuedToken) pendingForceTokenByKey.delete(requestKey);
        const queuedUntokened = pendingForceRefetchKeys.delete(requestKey);
        if (!queuedToken && !queuedUntokened) return;
        force = true;
        forceToken = queuedToken;
      }
    },
    [authIdentityKey, authRef, setEntries, withFreshToken]
  );
}
