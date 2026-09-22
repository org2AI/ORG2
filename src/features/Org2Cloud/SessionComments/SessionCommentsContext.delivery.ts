/**
 * Team Chat delivery callbacks for `SessionCommentsProvider`: `addComment`
 * with the one-shot session-admission repair, and `retryComment` for a
 * visible failed row (optionally edited).
 */
import { useAtomValue } from "jotai";
import { useCallback } from "react";

import type { ComposerSnapshot } from "@src/components/ComposerInput";
import type { Session } from "@src/store/session/sessionAtom/types";

import { getSessionForkedFrom } from "../../TeamCollaboration/forkSession";
import {
  isTeamChatBodyWithinLimit,
  isTeamChatMentionAudienceWithinLimit,
  resolveTeamChatMentionedUserIds,
} from "../SessionConversation/teamChatMentions";
import {
  org2CloudAuthAtom,
  org2CloudAuthIdentityKey,
} from "../org2CloudAuthAtom";
import type { CloudOrgMember } from "../org2CloudClient";
import {
  CLOUD_COMMENT_MAX_BODY_LENGTH,
  CLOUD_COMMENT_MAX_MENTIONED_USER_IDS,
  type CloudSessionComment,
} from "../org2CloudCommentsClient";
import {
  type AddCommentInput,
  OPTIMISTIC_SESSION_COMMENT_ID_PREFIX,
} from "../org2CloudSessionCommentsAtom";
import { org2CloudSyncEngine } from "../org2CloudSyncEngine";
import type { SessionCommentTarget } from "../sessionCommentTarget";
import {
  addCommentWithSessionAdmissionRecovery,
  buildCloudCommentRetryCasSteps,
  claimCloudCommentRetryAttempt,
  cloudCommentRetryAttemptKey,
  releaseCloudCommentRetryAttempt,
} from "./SessionCommentsContext.retry";

export interface SessionCommentDelivery {
  addCommentWithRecovery: (
    input: AddCommentInput
  ) => Promise<CloudSessionComment>;
  retryComment: (
    commentId: string,
    editedBody?: string,
    composerSnapshot?: ComposerSnapshot
  ) => Promise<void>;
}

export function useSessionCommentDelivery(input: {
  session: Session | null | undefined;
  target: SessionCommentTarget | null;
  comments: readonly CloudSessionComment[];
  addComment: (input: AddCommentInput) => Promise<CloudSessionComment>;
  mentionableMembers: readonly CloudOrgMember[];
}): SessionCommentDelivery {
  const { session, target, comments, addComment, mentionableMembers } = input;
  const retryAuth = useAtomValue(org2CloudAuthAtom);
  const retryAuthIdentityKey = retryAuth
    ? org2CloudAuthIdentityKey(retryAuth)
    : null;
  const addCommentWithRecovery = useCallback(
    (input: AddCommentInput): Promise<CloudSessionComment> => {
      const stableInput: AddCommentInput = {
        ...input,
        optimisticId:
          input.optimisticId ??
          `${OPTIMISTIC_SESSION_COMMENT_ID_PREFIX}${crypto.randomUUID()}`,
      };
      const locallyOwnedTarget = Boolean(
        session &&
        target &&
        session.session_id === target.sessionId &&
        !session.importedFrom &&
        !getSessionForkedFrom(session)
      );
      return addCommentWithSessionAdmissionRecovery(
        () => addComment(stableInput),
        locallyOwnedTarget && target
          ? async () => {
              org2CloudSyncEngine.invalidatePushedMetadataHash(
                target.orgId,
                target.sessionId
              );
              await org2CloudSyncEngine.runSyncPassAndWaitForDrain();
            }
          : null
      );
    },
    [addComment, session, target]
  );
  const retryComment = useCallback(
    async (
      commentId: string,
      editedBody?: string,
      composerSnapshot?: ComposerSnapshot
    ): Promise<void> => {
      const failed = comments.find((comment) => comment.id === commentId);
      if (
        !target ||
        !retryAuth ||
        !retryAuthIdentityKey ||
        !failed ||
        failed.clientDeliveryStatus !== "failed"
      ) {
        return;
      }
      const body = editedBody ?? failed.body;
      if (!isTeamChatBodyWithinLimit(body)) {
        throw new Error(
          `Team Chat messages must be ${CLOUD_COMMENT_MAX_BODY_LENGTH} characters or fewer`
        );
      }
      // The atom update that flips failed -> pending is visible on the next
      // render. Claim synchronously across every provider/pane as well so two
      // retry clicks in that window cannot issue duplicate Cloud writes. The
      // attempt token makes cleanup compare-and-swap safe across remounts.
      // Endpoint/account identity is part of the key: an old request must not
      // block or release the same logical row after an auth switch.
      const retryKey = cloudCommentRetryAttemptKey({
        authIdentityKey: retryAuthIdentityKey,
        orgId: target.orgId,
        sessionId: target.sessionId,
        commentId,
      });
      const attempt = claimCloudCommentRetryAttempt(retryKey);
      if (!attempt) return;
      try {
        const mentionedUserIds =
          editedBody === undefined
            ? (failed.mentionedUserIds ?? [])
            : resolveTeamChatMentionedUserIds(
                body,
                mentionableMembers,
                composerSnapshot,
                retryAuth.userId
              );
        if (!isTeamChatMentionAudienceWithinLimit(mentionedUserIds)) {
          throw new Error(
            `@all is unavailable when it would notify more than ${CLOUD_COMMENT_MAX_MENTIONED_USER_IDS} people`
          );
        }
        const steps = buildCloudCommentRetryCasSteps({
          failed,
          nextBody: body,
          nextMentionedUserIds: mentionedUserIds,
          edited: editedBody !== undefined,
        });
        for (const step of steps) {
          await addCommentWithRecovery({
            ...step,
            eventId: failed.eventId,
            parentId: failed.parentId,
            optimisticId: failed.id,
          });
        }
      } finally {
        releaseCloudCommentRetryAttempt(retryKey, attempt);
      }
    },
    [
      addCommentWithRecovery,
      comments,
      mentionableMembers,
      retryAuth,
      retryAuthIdentityKey,
      target,
    ]
  );
  return { addCommentWithRecovery, retryComment };
}
