/**
 * Per-(orgId, sessionId) session-comment threads (in-memory only).
 *
 * Maps `orgId|sessionId` → the session's `cloud_list_session_comments`
 * entries plus fetch state. Fetched lazily by `useSessionComments` when a
 * comment surface (replay transcript / header notes) mounts for a cloud
 * target, with a short TTL so toggling a thread panel doesn't refetch on
 * every render; `refresh()` bypasses the TTL. Mutations write through the
 * 0014 RPCs and patch the entry in place — the add RPC returns the created
 * row in listing shape, so the insert needs no refetch (design §4
 * "optimistic insert on add"). NOT persisted — visibility is server-side
 * (readable guard + retention window) and rows go stale.
 *
 * The fetch loop lives in `org2CloudSessionCommentsAtom.fetch.ts` and the
 * write-through mutations in `org2CloudSessionCommentsAtom.mutations.ts`;
 * this file owns the atom, the effects that schedule fetches, and the hook
 * that composes them.
 */
import { atom, useAtom, useAtomValue } from "jotai";
import { useCallback, useEffect, useRef } from "react";

import {
  org2CloudAuthAtom,
  org2CloudAuthIdentityKey,
} from "./org2CloudAuthAtom";
import {
  org2CloudCommentsSignalAtom,
  orgCommentsKey,
  sessionCommentsKey,
} from "./org2CloudCommentsBus";
import {
  EMPTY_ENTRY,
  sessionCommentsEntryForIdentity,
  sessionCommentsErrorRetryDelayMs,
} from "./org2CloudSessionCommentsAtom.commentTransforms";
import { useSessionCommentsFetcher } from "./org2CloudSessionCommentsAtom.fetch";
import { useCloudFreshAccessToken } from "./org2CloudSessionCommentsAtom.freshToken";
import { useSessionCommentMutations } from "./org2CloudSessionCommentsAtom.mutations";
import type {
  CloudSessionCommentsEntry,
  UseSessionCommentsResult,
} from "./org2CloudSessionCommentsAtom.types";

// Re-exports: preserve this module's public import path for symbols that
// now live in the sibling modules above (types / pure transforms /
// shared auth composition) — every existing importer keeps working
// unchanged.
export type {
  AddCommentInput,
  CloudSessionCommentsEntry,
  CloudSessionCommentsFetchState,
  GroupedCommentThreads,
  SessionComment,
  SessionCommentDeliveryStatus,
  UseSessionCommentsResult,
} from "./org2CloudSessionCommentsAtom.types";
export {
  MAX_SESSION_COMMENT_CACHE_ENTRIES,
  OPTIMISTIC_SESSION_COMMENT_ID_PREFIX,
  SESSION_COMMENTS_DELTA_OVERLAP_MS,
  sessionCommentsDeltaSince,
  countLiveComments,
  decideSessionCommentsFetch,
  getThreadResolution,
  groupCommentThreads,
  insertComment,
  isOptimisticSessionCommentId,
  isThreadResolved,
  mergeDeltaSessionComments,
  mergeFullSessionComments,
  mergePresentEventIdEntries,
  patchComment,
  sessionCommentsEntryForIdentity,
  shouldEvictSessionCommentsOnError,
  writeSessionCommentsEntry,
} from "./org2CloudSessionCommentsAtom.commentTransforms";
export { SessionCommentDeliveryError } from "./org2CloudSessionCommentsAtom.types";

export const org2CloudSessionCommentsAtom = atom<
  Record<string, CloudSessionCommentsEntry>
>({});
org2CloudSessionCommentsAtom.debugLabel = "org2CloudSessionCommentsAtom";

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

/**
 * Comments for `(orgId, sessionId)` (either null ⇒ no cloud comment target —
 * returns the idle empty entry, fetches nothing, mutations reject).
 * Auto-fetches when the entry is missing or older than the TTL. Multiple
 * mounted instances (turn chrome + header notes) share the atom entry; the
 * fetch CLAIM happens inside one atom updater (decide-and-mark against live
 * store state), so two instances mounting in the same commit cannot both
 * fire the list RPC — a render-snapshot guard would.
 *
 * The force-refetch de-dup state (in-flight claims, signal tokens) lives in
 * `org2CloudSessionCommentsAtom.forceTokenTracker.ts` — module-level because
 * the atom entry above is shared across every mounted hook instance for the
 * same key, so the de-dup state must be too.
 */
export function useSessionComments(
  orgId: string | null,
  sessionId: string | null,
  originSessionId: string | null = null
): UseSessionCommentsResult {
  const auth = useAtomValue(org2CloudAuthAtom);
  const authIdentityKey = auth ? org2CloudAuthIdentityKey(auth) : null;
  const authRef = useRef(auth);
  useEffect(() => {
    authRef.current = auth;
  }, [auth]);
  const [entries, setEntries] = useAtom(org2CloudSessionCommentsAtom);
  const signedIn = Boolean(auth);
  const key = orgId && sessionId ? sessionCommentsKey(orgId, sessionId) : null;

  const withFreshToken = useCloudFreshAccessToken();

  const fetchComments = useSessionCommentsFetcher({
    authIdentityKey,
    authRef,
    setEntries,
    withFreshToken,
  });

  useEffect(() => {
    if (!orgId || !sessionId || !signedIn) return;
    // TTL + in-flight dedup live inside fetchComments' atomic claim.
    void fetchComments(orgId, sessionId);
  }, [orgId, sessionId, signedIn, fetchComments]);

  const storedEntry = key ? entries[key] : undefined;
  const entry =
    sessionCommentsEntryForIdentity(storedEntry, authIdentityKey) ??
    EMPTY_ENTRY;
  const entryState = entry.state;

  const refresh = useCallback(() => {
    if (!orgId || !sessionId || !signedIn) return;
    void fetchComments(orgId, sessionId, { force: true });
  }, [orgId, sessionId, signedIn, fetchComments]);

  // Error retry: one deferred re-run per error result while a consumer is
  // mounted (the entry's fetchedAt changes on every attempt, re-arming the
  // effect). Not a recurring timer — it exists only while an error shows, and
  // consecutive failures widen the delay exponentially.
  const entryFetchedAt = entry.fetchedAt;
  const entryConsecutiveFailures = entry.consecutiveFailures ?? 1;
  useEffect(() => {
    if (!orgId || !sessionId || !signedIn) return undefined;
    if (entryState !== "error") return undefined;
    let timer: ReturnType<typeof setTimeout>;
    const delayMs = sessionCommentsErrorRetryDelayMs(entryConsecutiveFailures);
    const arm = () => {
      timer = setTimeout(() => {
        // Hidden windows stay network-silent: re-check after the same delay
        // instead of retrying a fetch nobody is looking at.
        if (
          typeof document !== "undefined" &&
          document.visibilityState === "hidden"
        ) {
          arm();
          return;
        }
        void fetchComments(orgId, sessionId, {});
      }, delayMs);
    };
    arm();
    return () => clearTimeout(timer);
  }, [
    orgId,
    sessionId,
    signedIn,
    entryState,
    entryFetchedAt,
    entryConsecutiveFailures,
    fetchComments,
  ]);

  // --- Realtime nudge (comments bus): a peer's comment/task mutation
  // broadcast bumps this counter — force-refetch immediately so the open
  // thread streams. Event-driven only; no timer.
  const commentsSignal = useAtomValue(org2CloudCommentsSignalAtom);
  const signalVersion =
    orgId && sessionId
      ? (commentsSignal[sessionCommentsKey(orgId, sessionId)] ?? 0)
      : 0;
  const orgSignalVersion = orgId
    ? (commentsSignal[orgCommentsKey(orgId)] ?? 0)
    : 0;
  // Past generations are covered by the mount/TTL fetch. Seed from the
  // current counters so mounting a second surface never replays old signals.
  const lastSignalRef = useRef({
    session: signalVersion,
    org: orgSignalVersion,
  });
  useEffect(() => {
    if (!orgId || !sessionId || !signedIn) return;
    const sessionChanged = signalVersion !== lastSignalRef.current.session;
    const orgChanged = orgSignalVersion !== lastSignalRef.current.org;
    if (!sessionChanged && !orgChanged) return;
    lastSignalRef.current = {
      session: signalVersion,
      org: orgSignalVersion,
    };
    if (signalVersion === 0 && orgSignalVersion === 0) return;
    if (sessionChanged) {
      void fetchComments(orgId, sessionId, {
        force: true,
        forceToken: `session:${signalVersion}`,
      });
      return;
    }
    // org_change_signals carries unrelated projects, sessions, scopes, and
    // comments. Let the existing TTL gate this coarse event instead of forcing
    // every open session to list comments for every org-level write.
    void fetchComments(orgId, sessionId);
  }, [
    orgId,
    sessionId,
    signedIn,
    signalVersion,
    orgSignalVersion,
    fetchComments,
  ]);

  const {
    insertLocalComment,
    addComment,
    editComment,
    deleteComment,
    resolveComment,
  } = useSessionCommentMutations({
    orgId,
    sessionId,
    originSessionId,
    key,
    authIdentityKey,
    authRef,
    setEntries,
    withFreshToken,
  });

  return {
    comments: entry.comments,
    viewerOwnsSession: entry.viewerOwnsSession,
    state: entry.state,
    refresh,
    insertLocalComment,
    addComment,
    editComment,
    deleteComment,
    resolveComment,
  };
}
