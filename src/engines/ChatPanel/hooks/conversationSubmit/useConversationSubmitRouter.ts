import { useStore } from "jotai";
import { useCallback } from "react";

import type {
  ConversationRootLocator,
  LocalConversationTarget,
} from "@src/engines/SessionCore/conversations/conversationTypes";
import {
  CanonicalConversationQueueAdmissionError,
  enqueueCanonicalConversation,
} from "@src/features/ConversationContinuation/enqueueCanonicalConversation";
import { useCloudSessionDownloadProgressEntry } from "@src/features/Org2Cloud/useCloudSessionDownloadSurface";
import type { Session } from "@src/store/session";

import { isImportedSessionSubmitBlocked } from "../importedSessionSubmitReadiness";
import {
  type SubmitOverrideInput,
  SubmitValidationError,
} from "../useInputArea/types";

interface UseConversationSubmitRouterOptions {
  sessionId: string;
  currentSession: Session | undefined;
  root: ConversationRootLocator | null;
  selectedTarget: LocalConversationTarget | null;
  /** Existing human/team-chat routing always gets first refusal. */
  onSurfaceSubmit: (input: SubmitOverrideInput) => Promise<boolean>;
}

interface CanonicalConversationRetryInput extends SubmitOverrideInput {
  turnIntentId?: string;
}

interface ConversationSubmitRouter {
  submit: (input: SubmitOverrideInput) => Promise<boolean>;
  /** Retry a failed Agent turn without routing it through Team Chat. */
  retry: (input: CanonicalConversationRetryInput) => Promise<boolean>;
}

/**
 * Distinguish an ordinary Session (no canonical root) from a canonical
 * conversation whose runtime inventory is still loading or unavailable.
 * Only the former may fall through to the legacy direct-session dispatcher.
 */
export function canonicalConversationTargetOrThrow(
  root: ConversationRootLocator | null,
  target: LocalConversationTarget | null
): LocalConversationTarget | null {
  if (!root) return null;
  if (!target) {
    throw new SubmitValidationError(
      "Select an available runtime before continuing this conversation"
    );
  }
  if (
    target.cliAgentType &&
    (target.cliAgentType !== "claude_code" || target.accountId) &&
    (!target.accountId || !target.model)
  ) {
    throw new SubmitValidationError(
      "Select a model and source before continuing this conversation"
    );
  }
  return target;
}

/**
 * Thin admission edge for canonical conversations.
 *
 * It does not execute providers, fork sessions, restore drafts, or maintain a
 * second queue. Human/team-chat routing remains the existing surface concern;
 * every Agent continuation is admitted into SessionCore's durable queue.
 */
export function useConversationSubmitRouter({
  sessionId,
  currentSession,
  root,
  selectedTarget,
  onSurfaceSubmit,
}: UseConversationSubmitRouterOptions): ConversationSubmitRouter {
  const store = useStore();
  const downloadProgress = useCloudSessionDownloadProgressEntry(sessionId);

  const enqueueCanonical = useCallback(
    async (input: CanonicalConversationRetryInput) => {
      if (
        isImportedSessionSubmitBlocked({
          sessionId,
          session: currentSession,
          progress: downloadProgress,
        })
      ) {
        throw new SubmitValidationError(
          "Wait for the shared session to finish loading before continuing"
        );
      }

      const target = canonicalConversationTargetOrThrow(root, selectedTarget);
      if (!root || !target) return false;

      try {
        return await enqueueCanonicalConversation({
          store,
          root,
          sessionId,
          input,
          target,
        });
      } catch (error) {
        if (error instanceof CanonicalConversationQueueAdmissionError) {
          throw new SubmitValidationError(error.message);
        }
        throw error;
      }
    },
    [currentSession, downloadProgress, root, selectedTarget, sessionId, store]
  );

  const submit = useCallback(
    async (input: SubmitOverrideInput) => {
      if (await onSurfaceSubmit(input)) return true;
      return enqueueCanonical(input);
    },
    [enqueueCanonical, onSurfaceSubmit]
  );

  return { submit, retry: enqueueCanonical };
}
