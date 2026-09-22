/**
 * Write-through mutations behind `useSessionComments` (see
 * `org2CloudSessionCommentsAtom.ts`): optimistic add, edit, delete and
 * resolve against the 0014 RPCs, each patching the shared entry in place
 * under the identity that issued it.
 */
import type { MutableRefObject } from "react";
import { useCallback } from "react";

import { deliverOptimisticOutgoing } from "@src/engines/SessionCore/services/optimisticOutgoingDelivery";
import { createLogger } from "@src/hooks/logger";

import { getCloudEndpoint } from "./config";
import {
  type Org2CloudAuthState,
  org2CloudAuthIdentityKey,
} from "./org2CloudAuthAtom";
import { broadcastCommentsChangedToPeers } from "./org2CloudCommentsBus";
import {
  type CloudCommentResolution,
  type CloudSessionComment,
  addSessionComment,
  deleteSessionComment,
  editSessionComment,
  resolveSessionComment,
} from "./org2CloudCommentsClient";
import {
  EMPTY_ENTRY,
  OPTIMISTIC_SESSION_COMMENT_ID_PREFIX,
  insertComment,
  isOptimisticSessionCommentId,
  patchComment,
  writeSessionCommentsEntry,
} from "./org2CloudSessionCommentsAtom.commentTransforms";
import type { SessionCommentsEntriesUpdater } from "./org2CloudSessionCommentsAtom.fetch";
import { SessionCommentDeliveryError } from "./org2CloudSessionCommentsAtom.types";
import type {
  AddCommentInput,
  SessionComment,
  UseSessionCommentsResult,
} from "./org2CloudSessionCommentsAtom.types";

const log = createLogger("Org2CloudSessionComments");

export type SessionCommentMutations = Pick<
  UseSessionCommentsResult,
  | "insertLocalComment"
  | "addComment"
  | "editComment"
  | "deleteComment"
  | "resolveComment"
>;

export function useSessionCommentMutations(input: {
  orgId: string | null;
  sessionId: string | null;
  originSessionId: string | null;
  key: string | null;
  authIdentityKey: string | null;
  authRef: MutableRefObject<Org2CloudAuthState | null>;
  setEntries: SessionCommentsEntriesUpdater;
  withFreshToken: () => Promise<string>;
}): SessionCommentMutations {
  const {
    orgId,
    sessionId,
    originSessionId,
    key,
    authIdentityKey,
    authRef,
    setEntries,
    withFreshToken,
  } = input;

  /** Apply a pure comments transform to the current entry. */
  const patchEntry = useCallback(
    (
      targetKey: string,
      transform: (comments: SessionComment[]) => SessionComment[]
    ) => {
      const identityKey = authIdentityKey;
      if (!identityKey) return;
      setEntries((previous) => {
        const latestAuth = authRef.current;
        if (
          !latestAuth ||
          org2CloudAuthIdentityKey(latestAuth) !== identityKey
        ) {
          return previous;
        }
        const stored = previous[targetKey];
        const entry =
          stored?.identityKey === identityKey ? stored : EMPTY_ENTRY;
        return writeSessionCommentsEntry(previous, targetKey, {
          ...entry,
          identityKey,
          comments: transform(entry.comments),
        });
      });
    },
    [authIdentityKey, authRef, setEntries]
  );

  const insertLocalComment = useCallback(
    (comment: CloudSessionComment): void => {
      if (!key) return;
      patchEntry(key, (comments) => insertComment(comments, comment));
    },
    [key, patchEntry]
  );

  const freshTokenForCurrentIdentity = useCallback(async () => {
    const identityKey = authIdentityKey;
    if (!identityKey) throw new Error("not signed in to ORG2 Cloud");
    const accessToken = await withFreshToken();
    const latestAuth = authRef.current;
    if (!latestAuth || org2CloudAuthIdentityKey(latestAuth) !== identityKey) {
      throw new Error("ORG2 Cloud identity changed during the request");
    }
    return { accessToken, identityKey };
  }, [authIdentityKey, authRef, withFreshToken]);

  const isCurrentIdentity = useCallback(
    (identityKey: string): boolean => {
      const latestAuth = authRef.current;
      return Boolean(
        latestAuth && org2CloudAuthIdentityKey(latestAuth) === identityKey
      );
    },
    [authRef]
  );

  const prepareCommentBody = useCallback(
    async (body: string, accessToken: string, identityKey: string) => {
      if (!body.includes("[file:")) return body;
      if (!orgId || !sessionId) throw new Error("no cloud comment target");
      const endpoint = getCloudEndpoint();
      const { prepareSharedCommentFiles } =
        await import("./prepareSharedCommentFiles");
      return prepareSharedCommentFiles({
        body,
        token: accessToken,
        endpoint,
        orgId,
        sessionId,
        assertCurrentIdentity: () => {
          if (
            !isCurrentIdentity(identityKey) ||
            getCloudEndpoint().supabaseUrl !== endpoint.supabaseUrl ||
            authRef.current?.supabaseUrl !== endpoint.supabaseUrl
          ) {
            throw new Error("ORG2 Cloud identity changed during file upload");
          }
        },
      });
    },
    [orgId, sessionId, isCurrentIdentity, authRef]
  );

  const addComment = useCallback(
    async (input: AddCommentInput): Promise<CloudSessionComment> => {
      if (!orgId || !sessionId || !key) {
        throw new Error("no cloud comment target");
      }
      const optimistic: CloudSessionComment = {
        id:
          input.optimisticId ??
          `${OPTIMISTIC_SESSION_COMMENT_ID_PREFIX}${crypto.randomUUID()}`,
        eventId: input.eventId,
        parentId: input.parentId,
        authorUserId: authRef.current?.userId ?? "",
        authorDisplayName: authRef.current?.profile?.displayName ?? undefined,
        body: input.body,
        createdAt: new Date().toISOString(),
        kind: "user",
        mentionedUserIds: input.mentionedUserIds ?? [],
        clientDeliveryStatus: "pending",
        ...(input.replaceExisting
          ? {
              clientRetryExpectedBody: input.expectedBody,
              clientRetryExpectedMentionedUserIds:
                input.expectedMentionedUserIds ?? [],
            }
          : {}),
      };
      // A retry re-sends under the SAME optimistic id: replace the row in
      // place and keep its original timestamp so the retained message does
      // not jump out of the transcript position the user is looking at.
      patchEntry(key, (comments) => {
        const retainedRow = comments.find(
          (candidate) => candidate.id === optimistic.id
        );
        return insertComment(
          comments,
          retainedRow
            ? { ...optimistic, createdAt: retainedRow.createdAt }
            : optimistic
        );
      });
      let retained = false;
      const delivered = await deliverOptimisticOutgoing({
        send: async () => {
          const { accessToken, identityKey } =
            await freshTokenForCurrentIdentity();
          const body = await prepareCommentBody(
            input.body,
            accessToken,
            identityKey
          );
          // Retain uploaded references if the RPC response is lost. Retry sends
          // these same immutable ids even if the sender changes the local file.
          if (body !== input.body)
            patchEntry(key, (comments) =>
              patchComment(comments, optimistic.id, { body })
            );
          const comment = await addSessionComment(accessToken, {
            orgId,
            sessionId,
            body,
            eventId: input.eventId,
            parentId: input.parentId,
            mentionedUserIds: input.mentionedUserIds,
            clientMessageKey: optimistic.id,
            replaceExisting: input.replaceExisting,
            expectedBody: input.expectedBody,
            expectedMentionedUserIds: input.expectedMentionedUserIds,
            ...(originSessionId && originSessionId !== sessionId
              ? { originSessionId }
              : {}),
          });
          return { comment, identityKey };
        },
        markSent: ({ comment, identityKey }) => {
          if (!isCurrentIdentity(identityKey)) return;
          // Replace the local echo with the server-authored row atomically.
          patchEntry(key, (comments) =>
            insertComment(
              comments.filter((candidate) => candidate.id !== optimistic.id),
              comment
            )
          );
          broadcastCommentsChangedToPeers(orgId, sessionId);
        },
        markFailed: (error) => {
          patchEntry(key, (comments) => {
            retained = comments.some(
              (candidate) => candidate.id === optimistic.id
            );
            return patchComment(comments, optimistic.id, {
              clientDeliveryStatus: "failed",
              clientDeliveryError:
                error instanceof Error ? error.message : String(error),
            });
          });
        },
        onProjectionError: (phase, error) => {
          log.error(
            `Failed to project ${phase} Cloud comment delivery for ${sessionId}`,
            error
          );
        },
      }).catch((error: unknown) => {
        // Only claim delivery ownership when a failed row is actually on
        // screen. Otherwise the composer is still the sole copy of the text
        // and must restore it.
        if (!retained) throw error;
        throw new SessionCommentDeliveryError(optimistic.id, error);
      });
      return delivered.comment;
    },
    [
      orgId,
      sessionId,
      originSessionId,
      key,
      authRef,
      freshTokenForCurrentIdentity,
      isCurrentIdentity,
      patchEntry,
      prepareCommentBody,
    ]
  );

  const editComment = useCallback(
    async (commentId: string, body: string): Promise<void> => {
      if (!orgId || !key) throw new Error("no cloud comment target");
      if (isOptimisticSessionCommentId(commentId)) {
        let edited = false;
        patchEntry(key, (comments) =>
          comments.map((comment) => {
            if (
              comment.id !== commentId ||
              comment.clientDeliveryStatus !== "failed"
            ) {
              return comment;
            }
            edited = true;
            return { ...comment, body };
          })
        );
        if (!edited) throw new Error("only failed Team Chat messages can edit");
        return;
      }
      const { accessToken, identityKey } = await freshTokenForCurrentIdentity();
      body = await prepareCommentBody(body, accessToken, identityKey);
      const editedAt = await editSessionComment(
        accessToken,
        orgId,
        commentId,
        body
      );
      if (!isCurrentIdentity(identityKey)) return;
      patchEntry(key, (comments) =>
        patchComment(comments, commentId, { body, editedAt })
      );
      if (sessionId) broadcastCommentsChangedToPeers(orgId, sessionId);
    },
    [
      orgId,
      sessionId,
      key,
      freshTokenForCurrentIdentity,
      isCurrentIdentity,
      patchEntry,
      prepareCommentBody,
    ]
  );

  const deleteComment = useCallback(
    async (commentId: string): Promise<void> => {
      if (!orgId || !key) throw new Error("no cloud comment target");
      const { accessToken, identityKey } = await freshTokenForCurrentIdentity();
      await deleteSessionComment(accessToken, orgId, commentId);
      if (!isCurrentIdentity(identityKey)) return;
      // Mirror the server's soft delete: stamp + blank body (tombstone).
      patchEntry(key, (comments) =>
        patchComment(comments, commentId, {
          deletedAt: new Date().toISOString(),
          body: "",
          mentionedUserIds: [],
        })
      );
      if (sessionId) broadcastCommentsChangedToPeers(orgId, sessionId);
    },
    [
      orgId,
      sessionId,
      key,
      freshTokenForCurrentIdentity,
      isCurrentIdentity,
      patchEntry,
    ]
  );

  const resolveComment = useCallback(
    async (
      commentId: string,
      resolved: boolean,
      resolution?: CloudCommentResolution
    ): Promise<void> => {
      if (!orgId || !key) throw new Error("no cloud comment target");
      const { accessToken, identityKey } = await freshTokenForCurrentIdentity();
      await resolveSessionComment(
        accessToken,
        orgId,
        commentId,
        resolved,
        resolution
      );
      if (!isCurrentIdentity(identityKey)) return;
      patchEntry(key, (comments) =>
        patchComment(comments, commentId, {
          resolvedAt: resolved ? new Date().toISOString() : undefined,
          resolution: resolved ? (resolution ?? "resolved") : undefined,
        })
      );
      if (sessionId) broadcastCommentsChangedToPeers(orgId, sessionId);
    },
    [
      orgId,
      sessionId,
      key,
      freshTokenForCurrentIdentity,
      isCurrentIdentity,
      patchEntry,
    ]
  );

  return {
    insertLocalComment,
    addComment,
    editComment,
    deleteComment,
    resolveComment,
  };
}
