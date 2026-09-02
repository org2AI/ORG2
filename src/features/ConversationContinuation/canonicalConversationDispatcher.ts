import type { Store } from "jotai/vanilla/store";

import { getImportedHistorySourceBySessionId } from "@src/api/tauri/externalHistory";
import { loadCanonicalConversationEvents } from "@src/engines/SessionCore/conversations/canonicalConversationEvents";
import {
  continueLocalConversationAfterTimelineLoad,
  recoverLocalConversationTurn,
} from "@src/engines/SessionCore/conversations/localConversationContinuation";
import type {
  QueuedConversationDispatcher,
  QueuedConversationExecutionMessage,
} from "@src/engines/SessionCore/conversations/queuedConversationContract";
import {
  QueuedConversationBlockedError,
  QueuedConversationRecoveryPendingError,
} from "@src/engines/SessionCore/conversations/queuedConversationContract";
import { dispatchQueuedCloudConversation } from "@src/features/Org2Cloud/SessionConversation/cloudConversationQueueAdapter";
import type { Session } from "@src/store/session";
import { sessionsAtom } from "@src/store/session";

import { resolveExternalHistoryContinuation } from "./externalHistoryContinuation";

function sessionById(store: Store, sessionId: string): Session | undefined {
  return store
    .get(sessionsAtom)
    .find((candidate) => candidate.session_id === sessionId);
}

async function dispatchQueuedLocalConversation(
  store: Store,
  message: QueuedConversationExecutionMessage,
  callbacks: Parameters<QueuedConversationDispatcher>[2]
): Promise<void> {
  const descriptor = message.conversationDispatch;
  if (!descriptor) throw new Error("canonical conversation target is missing");
  const { root } = descriptor;
  let { target } = descriptor;
  const sourceSession = sessionById(store, message.sessionId);
  let title = sourceSession?.name ?? "Conversation";
  if (getImportedHistorySourceBySessionId(message.sessionId)) {
    const resolved = await resolveExternalHistoryContinuation({
      sourceSessionId: message.sessionId,
      sourceSession,
      target,
    });
    target = resolved.target;
    title = resolved.title;
  }

  if (
    root.authority !== "local-session" &&
    root.authority !== "imported-history"
  ) {
    throw new Error(
      `unsupported local conversation authority: ${root.authority}`
    );
  }
  let runnerReady = false;
  let providerAccepted = message.status === "accepted";
  const announceRunner = async (
    sessionId: string,
    eventStartIndex: number
  ): Promise<void> => {
    runnerReady = true;
    try {
      await callbacks.onRunnerReady?.(sessionId, eventStartIndex);
    } catch (error) {
      // The native child already exists at this boundary. Keep the global
      // execution owner so the same turn can reconnect to that child; treating
      // this as an ordinary send failure would create another native episode.
      throw new QueuedConversationRecoveryPendingError(
        `runner ${sessionId} recovery receipt could not be persisted: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  };
  const continuationParams = {
    root,
    title,
    loadTimeline: async () =>
      (await loadCanonicalConversationEvents(message.sessionId)).events,
    displayText: message.displayContent,
    agentContent: message.content,
    imageDataUrls: message.imageDataUrls,
    target,
    turnIntentId: message.turnIntentId,
    onSessionPreparing: (sessionId: string) =>
      announceRunner(sessionId, Number.MAX_SAFE_INTEGER),
    onSessionReady: announceRunner,
    onTurnAccepted: async (sessionId: string) => {
      providerAccepted = true;
      await callbacks.onAccepted(sessionId);
    },
  };
  if (message.runnerSessionId) {
    const recovered = await recoverLocalConversationTurn({
      ...continuationParams,
      timeline: await continuationParams.loadTimeline(),
      runnerSessionId: message.runnerSessionId,
      eventStartIndex: message.runnerEventStartIndex,
    });
    if (recovered) return;
    if (message.status === "accepted") {
      throw new QueuedConversationRecoveryPendingError();
    }
  }
  try {
    await continueLocalConversationAfterTimelineLoad(continuationParams);
  } catch (error) {
    if (
      error instanceof QueuedConversationRecoveryPendingError &&
      !runnerReady &&
      !providerAccepted
    ) {
      // Candidate/source inspection happens before a visible native runner or
      // provider boundary. Keep the user's intent visible in the existing
      // held queue instead of hiding it behind an execution retry loop.
      throw new QueuedConversationBlockedError(error.message);
    }
    throw error;
  }
}

/** The sole canonical executor injected into SessionCore's existing queue. */
export const dispatchQueuedCanonicalConversation: QueuedConversationDispatcher =
  async (store, message, callbacks) => {
    const descriptor = message.conversationDispatch;
    if (!descriptor || descriptor.kind !== "canonical_conversation") {
      throw new Error("queued message is not a canonical conversation turn");
    }
    if (descriptor.root.authority === "org2-cloud") {
      return await dispatchQueuedCloudConversation(
        store,
        message,
        descriptor.root,
        callbacks
      );
    }
    return await dispatchQueuedLocalConversation(store, message, callbacks);
  };
