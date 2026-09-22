/**
 * SessionCommentsContext — one comments state per mounted chat surface
 * (managed-cloud collaboration design).
 *
 * The provider lives in ChatView (which owns the Session object AND the
 * replay event stream) and resolves the cloud comment target once; the
 * per-turn chrome inside the virtualized transcript consumes the context
 * instead of re-running target resolution + atom subscriptions per group
 * header. NON-cloud sessions get a null context value — every consumer
 * renders nothing, so the ordinary chat surface is untouched.
 *
 * Context (not a global atom) on purpose: multiple ChatViews can be
 * mounted at once (split panes / editor tabs) and each needs its own
 * target. The one cross-tree bridge — the replay stream's event-id set,
 * needed by the HEADER notes dialog to bucket orphaned anchors — is a
 * session-id-keyed registry atom written here and read by
 * `SessionCommentsHeaderExtras` (the header renders outside ChatView).
 *
 * Retry planning, viewer probes, anchor presence, and delivery callbacks
 * live in the sibling `SessionCommentsContext.*` modules; this file keeps
 * the context value shape and the provider that composes them.
 */
import { useAtomValue } from "jotai";
import React, { createContext, useCallback, useContext, useMemo } from "react";

import type { ComposerSnapshot } from "@src/components/ComposerInput";
import type { Session } from "@src/store/session/sessionAtom/types";

import { stripCopyEventNamespace } from "../../TeamCollaboration/copyEventId";
import { getSessionForkedFrom } from "../../TeamCollaboration/forkSession";
import { SharedSessionFilesProvider } from "../SharedSessionFilesContext";
import { collectAddressableThreads } from "../addressComments";
import { addressRunActiveAtom } from "../addressCommentsRun";
import type { CloudOrgMember } from "../org2CloudClient";
import type {
  CloudCommentResolution,
  CloudSessionComment,
} from "../org2CloudCommentsClient";
import {
  type AddCommentInput,
  type CloudSessionCommentsFetchState,
  type GroupedCommentThreads,
  groupCommentThreads,
  useSessionComments,
} from "../org2CloudSessionCommentsAtom";
import {
  type SessionCommentTarget,
  useSessionCommentTarget,
} from "../sessionCommentTarget";
import { useOwnedCloudCommentAgentRun } from "../useOwnedCloudCommentAgentRun";
import { useSessionCommentDelivery } from "./SessionCommentsContext.delivery";
import {
  buildCloudCommentSourceEventIdMap,
  usePublishSessionCommentPresentEventIds,
} from "./SessionCommentsContext.presentEventIds";
import {
  useSessionCommentMentionableMembers,
  useSessionCommentViewer,
} from "./SessionCommentsContext.viewer";
import type { CommentAnchorEventIdentity } from "./commentAnchorIdentities";

// Re-exports: preserve this module's public import path for symbols that
// now live in the sibling modules above — every existing importer keeps
// working unchanged.
export {
  addCommentWithSessionAdmissionRecovery,
  buildCloudCommentRetryCasSteps,
  cloudCommentRetryAttemptKey,
} from "./SessionCommentsContext.retry";
export { buildCloudCommentSourceEventIdMap } from "./SessionCommentsContext.presentEventIds";

export type { CommentAnchorEventIdentity };

export interface SessionCommentsContextValue {
  target: SessionCommentTarget;
  state: CloudSessionCommentsFetchState;
  /** Raw rows used by the shared canonical timeline assembler. */
  comments: readonly CloudSessionComment[];
  grouped: GroupedCommentThreads;
  /**
   * Map a local (possibly fork/import-namespaced) event id to the source-plane
   * event id comments anchor by. Identity for ordinary sessions.
   */
  toSourceEventId: (eventId: string) => string;
  /**
   * False when the rendered transcript is not this session's own stream
   * (group-chat merged view) — TurnCommentChrome renders nothing.
   */
  turnAnchorsVisible: boolean;
  /**
   * False when the cloud row says the session is NOT full_replay —
   * turn-anchored composers disable with a tooltip (the server enforces
   * regardless; UI mirrors it). Unknown rows default to true.
   */
  canAnchorTurns: boolean;
  viewerUserId: string | null;
  /** Org admin/owner — may delete any comment (moderation surface). */
  viewerIsAdmin: boolean;
  /** Active org members available for identity-stable mentions. */
  mentionableMembers: readonly CloudOrgMember[];
  refresh: () => void;
  addComment: (input: AddCommentInput) => Promise<CloudSessionComment>;
  /** Retry a visible failed Team Chat row, optionally with edited text. */
  retryComment: (
    commentId: string,
    editedBody?: string,
    composerSnapshot?: ComposerSnapshot
  ) => Promise<void>;
  /**
   * Batch follow-up (design 2026-07-11): address every unresolved thread as
   * one owner-only agent round, then post one parsed reply per thread. A
   * writable source/fork runs in place; immutable owner history first forks.
   * Null ⇒ not available here (non-owner/import or nothing unresolved).
   */
  addressAllComments: (() => Promise<void>) | null;
  addressRunActive: boolean;
  /** Null means every unresolved thread; otherwise only these heads are live. */
  addressRunSelectedHeadIds: ReadonlySet<string> | null;
  unresolvedThreadCount: number;
  editComment: (commentId: string, body: string) => Promise<void>;
  deleteComment: (commentId: string) => Promise<void>;
  resolveComment: (
    commentId: string,
    resolved: boolean,
    resolution?: CloudCommentResolution
  ) => Promise<void>;

  /**
   * Fail-open like `canAnchorTurns`: the server is the real gate
   * (readable guard + `forkSharedSessionEnabled` at claim). False only on
   * the one locally-KNOWN blocker — no signed-in cloud user.
   */
  canRunAgent: boolean;
  /** Run a personal @agent round for this comment on the local session. */
  requestAgent: (commentId: string, instruction?: string) => Promise<void>;
}

const SessionCommentsContext =
  createContext<SessionCommentsContextValue | null>(null);

export function useSessionCommentsContext(): SessionCommentsContextValue | null {
  return useContext(SessionCommentsContext);
}

export interface SessionCommentsProviderProps {
  session: Session | null | undefined;
  /** Canonical Cloud conversation coordinates carried by a native episode. */
  targetOverride?: SessionCommentTarget | null;
  /**
   * Events currently present in the replay stream (anchor presence for
   * orphan bucketing). `null` = presence UNKNOWN (snapshot not hydrated
   * yet) — threads must not be bucketed as orphans off an empty pre-load
   * set. Only the ids are read, and only for cloud targets — ordinary
   * sessions never pay the id-set build.
   */
  events: readonly CommentAnchorEventIdentity[] | null;
  /**
   * False when the rendered transcript is NOT this session's own stream
   * (agent-org group-chat view merges member-session events, whose ids can
   * never anchor into THIS session) — turn chrome hides; the header Notes
   * dialog stays available.
   */
  turnAnchorsVisible?: boolean;
  children?: React.ReactNode;
}

export const SessionCommentsProvider: React.FC<
  SessionCommentsProviderProps
> = ({
  session,
  targetOverride,
  events,
  turnAnchorsVisible = true,
  children,
}) => {
  const target = useSessionCommentTarget(session, targetOverride);
  // Comments live on the SOURCE session's plane, anchored by the raw source
  // event id shared across all users. A fork/import copy carries namespaced
  // local ids, so anchor matching must happen in source-id space.
  const localSessionId = target ? (session?.session_id ?? null) : null;
  // Origin attribution is for per-fork counts, so it is stamped ONLY for a
  // writable fork. An import (read-only replay) or a plain tagged session must
  // not create a bogus origin bucket — they coalesce to the source at count
  // time.
  const originSessionId =
    session && getSessionForkedFrom(session) ? localSessionId : null;
  const sourceEventIdByLocalId = useMemo(
    () =>
      target && session && events
        ? buildCloudCommentSourceEventIdMap(session, events)
        : null,
    [target, session, events]
  );
  const toSourceEventId = useCallback(
    (eventId: string) =>
      sourceEventIdByLocalId?.get(eventId) ??
      (localSessionId
        ? stripCopyEventNamespace(localSessionId, eventId)
        : eventId),
    [sourceEventIdByLocalId, localSessionId]
  );
  const presentEventIds = useMemo<ReadonlySet<string> | null>(
    () =>
      target && events
        ? new Set(events.map((event) => toSourceEventId(event.id)))
        : null,
    [target, events, toSourceEventId]
  );
  const {
    comments,
    viewerOwnsSession,
    state,
    refresh,
    addComment,
    editComment,
    deleteComment,
    resolveComment,
  } = useSessionComments(
    target?.orgId ?? null,
    target?.sessionId ?? null,
    originSessionId
  );
  const mentionableMembers = useSessionCommentMentionableMembers(target);
  const { addCommentWithRecovery, retryComment } = useSessionCommentDelivery({
    session,
    target,
    comments,
    addComment,
    mentionableMembers,
  });
  const viewer = useSessionCommentViewer(target);

  usePublishSessionCommentPresentEventIds(localSessionId, presentEventIds);

  const grouped = useMemo(
    () => groupCommentThreads(comments, presentEventIds),
    [comments, presentEventIds]
  );

  const { available: ownerAgentAvailable, run: runOwnerAgent } =
    useOwnedCloudCommentAgentRun({
      session,
      target,
      viewerOwnsSession,
      onFinished: refresh,
    });

  const requestAgent = useCallback(
    async (commentId: string, instruction?: string): Promise<void> => {
      await runOwnerAgent({
        selectedHeadIds: [commentId],
        ...(instruction !== undefined ? { instruction } : {}),
      });
    },
    [runOwnerAgent]
  );

  // --- Address comments (batch owner-only follow-up) ---
  const addressRunActiveMap = useAtomValue(addressRunActiveAtom);
  const addressRunActivity = localSessionId
    ? addressRunActiveMap[localSessionId]
    : undefined;
  const addressRunActive = addressRunActivity !== undefined;
  const addressRunSelectedHeadIds = useMemo(
    () =>
      addressRunActivity?.selectedHeadIds === null ||
      addressRunActivity === undefined
        ? null
        : new Set(addressRunActivity.selectedHeadIds),
    [addressRunActivity]
  );
  const addressableThreads = useMemo(
    () => collectAddressableThreads(comments),
    [comments]
  );
  const unresolvedThreadCount = addressableThreads.length;
  const canAddressComments = Boolean(
    ownerAgentAvailable && unresolvedThreadCount > 0
  );

  const addressAllCommentsImpl = useCallback(async (): Promise<void> => {
    await runOwnerAgent();
  }, [runOwnerAgent]);

  const value = useMemo<SessionCommentsContextValue | null>(() => {
    if (!target) return null;
    return {
      target,
      state,
      comments,
      grouped,
      toSourceEventId,
      turnAnchorsVisible,
      canAnchorTurns: viewer.canAnchorTurns,
      viewerUserId: viewer.viewerUserId,
      viewerIsAdmin: viewer.viewerIsAdmin,
      mentionableMembers,
      refresh,
      addComment: addCommentWithRecovery,
      retryComment,
      editComment,
      deleteComment,
      resolveComment,
      canRunAgent: viewer.viewerUserId !== null && ownerAgentAvailable,
      requestAgent,
      addressAllComments: canAddressComments ? addressAllCommentsImpl : null,
      addressRunActive,
      addressRunSelectedHeadIds,
      unresolvedThreadCount,
    };
  }, [
    target,
    state,
    comments,
    grouped,
    toSourceEventId,
    turnAnchorsVisible,
    viewer,
    mentionableMembers,
    refresh,
    addCommentWithRecovery,
    retryComment,
    editComment,
    deleteComment,
    resolveComment,
    requestAgent,
    ownerAgentAvailable,
    canAddressComments,
    addressAllCommentsImpl,
    addressRunActive,
    addressRunSelectedHeadIds,
    unresolvedThreadCount,
  ]);

  return (
    <SessionCommentsContext.Provider value={value}>
      {/* File origin survives logout and loss of comment access. Local and writable-fork transcripts keep local navigation. */}
      <SharedSessionFilesProvider
        scope={
          session?.importedFrom
            ? {
                orgId: session.importedFrom.orgId,
                sessionId: session.importedFrom.sourceSessionId,
                endpoint:
                  session.importedFrom.sourceEndpointUrl ??
                  session.importedFrom.shareEndpointUrl ??
                  "",
                repoPath: session.repoPath,
              }
            : null
        }
      >
        {children}
      </SharedSessionFilesProvider>
    </SessionCommentsContext.Provider>
  );
};
