/**
 * Retry planning and admission recovery for failed Team Chat rows
 * (`SessionCommentsContext`): the module-level attempt registry is shared
 * across every mounted provider/pane so two retry clicks in the same window
 * cannot issue duplicate Cloud writes.
 */
import {
  type CloudSessionComment,
  isOrg2CommentErrorCode,
} from "../org2CloudCommentsClient";
import { SessionCommentDeliveryError } from "../org2CloudSessionCommentsAtom";

const activeCloudCommentRetryAttempts = new Map<string, symbol>();

export function cloudCommentRetryAttemptKey(input: {
  authIdentityKey: string;
  orgId: string;
  sessionId: string;
  commentId: string;
}): string {
  return [
    input.authIdentityKey,
    input.orgId,
    input.sessionId,
    input.commentId,
  ].join("\u001f");
}

export interface CloudCommentRetryCasStep {
  body: string;
  mentionedUserIds: string[];
  replaceExisting: boolean;
  expectedBody?: string;
  expectedMentionedUserIds?: string[];
}

function sameMentionedUserIds(
  left: readonly string[],
  right: readonly string[]
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

/**
 * Plan an idempotent retry without guessing which side of a lost response
 * Cloud committed. If an earlier edited retry changed A -> B but its response
 * was lost, a later edit to C must first replay/confirm A -> B and only then
 * CAS B -> C. Sending C with expected A directly would conflict forever when
 * Cloud already contains B.
 */
export function buildCloudCommentRetryCasSteps(input: {
  failed: Pick<
    CloudSessionComment,
    | "body"
    | "mentionedUserIds"
    | "clientRetryExpectedBody"
    | "clientRetryExpectedMentionedUserIds"
  >;
  nextBody: string;
  nextMentionedUserIds: readonly string[];
  edited: boolean;
}): CloudCommentRetryCasStep[] {
  const currentMentionedUserIds = [...(input.failed.mentionedUserIds ?? [])];
  const nextMentionedUserIds = [...input.nextMentionedUserIds];
  const originalExpectedBody = input.failed.clientRetryExpectedBody;
  const originalExpectedMentionedUserIds = [
    ...(input.failed.clientRetryExpectedMentionedUserIds ??
      currentMentionedUserIds),
  ];
  const changedAgain =
    input.edited &&
    (input.nextBody !== input.failed.body ||
      !sameMentionedUserIds(nextMentionedUserIds, currentMentionedUserIds));

  if (originalExpectedBody !== undefined && changedAgain) {
    return [
      {
        body: input.failed.body,
        mentionedUserIds: currentMentionedUserIds,
        replaceExisting: true,
        expectedBody: originalExpectedBody,
        expectedMentionedUserIds: originalExpectedMentionedUserIds,
      },
      {
        body: input.nextBody,
        mentionedUserIds: nextMentionedUserIds,
        replaceExisting: true,
        expectedBody: input.failed.body,
        expectedMentionedUserIds: currentMentionedUserIds,
      },
    ];
  }

  const replaceExisting = input.edited || originalExpectedBody !== undefined;
  return [
    {
      body: input.nextBody,
      mentionedUserIds: nextMentionedUserIds,
      replaceExisting,
      ...(replaceExisting
        ? {
            expectedBody: originalExpectedBody ?? input.failed.body,
            expectedMentionedUserIds:
              originalExpectedBody !== undefined
                ? originalExpectedMentionedUserIds
                : currentMentionedUserIds,
          }
        : {}),
    },
  ];
}

export function claimCloudCommentRetryAttempt(key: string): symbol | null {
  if (activeCloudCommentRetryAttempts.has(key)) return null;
  const attempt = Symbol(key);
  activeCloudCommentRetryAttempts.set(key, attempt);
  return attempt;
}

export function releaseCloudCommentRetryAttempt(
  key: string,
  attempt: symbol
): void {
  if (activeCloudCommentRetryAttempts.get(key) === attempt) {
    activeCloudCommentRetryAttempts.delete(key);
  }
}

/**
 * A repo-scope/tag can make Team Chat available a few milliseconds before
 * the owner push creates the Cloud session row. Repair that one admission
 * race through the existing sync engine, then retry the exact comment once.
 * Imported teammate sessions deliberately pass no repair callback.
 */
export async function addCommentWithSessionAdmissionRecovery(
  add: () => Promise<CloudSessionComment>,
  repair: (() => Promise<void>) | null
): Promise<CloudSessionComment> {
  try {
    return await add();
  } catch (error) {
    const cause =
      error instanceof SessionCommentDeliveryError ? error.cause : error;
    if (!repair || !isOrg2CommentErrorCode(cause, "ORG2_SESSION_NOT_FOUND")) {
      throw error;
    }
    try {
      await repair();
    } catch (repairError) {
      if (error instanceof SessionCommentDeliveryError) {
        throw new SessionCommentDeliveryError(error.commentId, repairError);
      }
      throw repairError;
    }
    // `add` carries the same optimisticId, so the replay re-sends the very
    // row the first attempt retained instead of creating a second one.
    return add();
  }
}
