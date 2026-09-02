import type { Store } from "jotai/vanilla/store";

import { getImportedHistorySourceBySessionId } from "@src/api/tauri/externalHistory";
import { loadCanonicalConversationEvents } from "@src/engines/SessionCore/conversations/canonicalConversationEvents";
import {
  type ConversationRootLocator,
  conversationRootKey,
} from "@src/engines/SessionCore/conversations/conversationTypes";
import {
  continueLocalConversationAfterTimelineLoad,
  recoverLocalConversationTurn,
} from "@src/engines/SessionCore/conversations/localConversationContinuation";
import type {
  QueuedConversationExecutionResult,
  QueuedConversationExecutor,
  QueuedConversationMessage,
} from "@src/engines/SessionCore/conversations/queuedConversationExecutor";
import { QueuedConversationBusyError } from "@src/engines/SessionCore/conversations/queuedConversationExecutor";
import { dispatchQueuedCloudConversation } from "@src/features/Org2Cloud/SessionConversation/queuedConversationExecutor";
import type { Session } from "@src/store/session";
import { loadSessions, sessionsAtom } from "@src/store/session";
import { publishSessionContinuationAtom } from "@src/store/session/sessionTabPlacementAtom";

import { resolveExternalHistoryContinuation } from "./externalHistoryContinuation";

const CANONICAL_CONVERSATION_LOCK_PREFIX = "orgii:canonical-conversation:";

/**
 * Serialize one canonical root across the main and detached Tauri webviews.
 *
 * Each webview intentionally owns its existing durable message queue, but a
 * canonical root can be visible in more than one window. Web Locks are already
 * the app's cross-webview mutex primitive (the Cloud auth refresh path uses the
 * same API). Holding this lock for the provider turn prevents two independent
 * queue realms from materializing and running divergent native episodes at
 * once. The queue remains the sole dispatcher; this is only its process-wide
 * root boundary, and a closed/crashed webview releases the lock automatically.
 */
export async function withCanonicalConversationTurnLock<T>(
  root: ConversationRootLocator,
  run: () => Promise<T>
): Promise<T> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks?.request) {
    throw new Error("canonical conversation lock is unavailable");
  }
  const name = `${CANONICAL_CONVERSATION_LOCK_PREFIX}${conversationRootKey(root)}`;
  let result:
    | { ok: true; value: T }
    | { ok: false; error: unknown }
    | undefined;
  try {
    // Keep callback failures inside a fulfilled lock request. Otherwise a
    // broad acquisition fallback cannot distinguish "Web Locks unavailable"
    // from "the provider turn failed" and may execute the same user turn a
    // second time outside the lock.
    result = (await locks.request(
      name,
      { mode: "exclusive", ifAvailable: true },
      async (lock) => {
        if (!lock) {
          return {
            ok: false as const,
            error: new QueuedConversationBusyError(),
          };
        }
        try {
          return { ok: true as const, value: await run() };
        } catch (error) {
          return { ok: false as const, error };
        }
      }
    )) as typeof result;
  } catch {
    // Executing unlocked is not safe: another window may already own this
    // canonical root and materialize a divergent native episode. Let the
    // existing queue surface a retryable failed message instead of risking a
    // duplicate provider turn.
    throw new Error("canonical conversation lock acquisition failed");
  }
  if (!result) {
    throw new Error("canonical conversation lock returned no result");
  }
  if (!result.ok) throw result.error;
  return result.value;
}

function sessionById(store: Store, sessionId: string): Session | undefined {
  return store
    .get(sessionsAtom)
    .find((candidate) => candidate.session_id === sessionId);
}

/** Notify the mounted surface; it owns how its current tab/window retargets. */
async function revealRunnerIfSourceIsVisible(
  store: Store,
  sourceSessionId: string,
  runnerSessionId: string,
  title: string,
  repoPath?: string
): Promise<void> {
  await loadSessions({ forceRefresh: true });
  store.set(publishSessionContinuationAtom, {
    sourceSessionId,
    sessionId: runnerSessionId,
    sessionName: title,
    repoPath,
  });
}

async function dispatchQueuedLocalConversation(
  store: Store,
  message: QueuedConversationMessage,
  callbacks: Parameters<QueuedConversationExecutor>[2]
): Promise<QueuedConversationExecutionResult> {
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
  let revealedRunnerSessionId: string | null = null;
  const revealRunner = async (sessionId: string) => {
    if (
      sessionId === message.sessionId ||
      revealedRunnerSessionId === sessionId
    ) {
      return;
    }
    revealedRunnerSessionId = sessionId;
    await revealRunnerIfSourceIsVisible(
      store,
      message.sessionId,
      sessionId,
      title,
      target.workspaceRepoPath ?? undefined
    );
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
    onSessionPreparing: async (sessionId: string) => {
      await callbacks.onRunnerReady?.(sessionId, Number.MAX_SAFE_INTEGER);
      await revealRunner(sessionId);
    },
    onSessionReady: async (sessionId: string, eventStartIndex: number) => {
      await callbacks.onRunnerReady?.(sessionId, eventStartIndex);
      await revealRunner(sessionId);
    },
    onTurnAccepted: callbacks.onAccepted,
  };
  if (message.status !== "queued" && message.runnerSessionId) {
    const recovered = await recoverLocalConversationTurn({
      ...continuationParams,
      timeline: await continuationParams.loadTimeline(),
      runnerSessionId: message.runnerSessionId,
      eventStartIndex: message.runnerEventStartIndex,
    });
    if (recovered) return { terminalStatus: recovered.terminalStatus };
  }
  const result =
    await continueLocalConversationAfterTimelineLoad(continuationParams);
  return { terminalStatus: result.terminalStatus };
}

/** The sole canonical executor injected into SessionCore's existing queue. */
export const dispatchQueuedCanonicalConversation: QueuedConversationExecutor =
  async (store, message, callbacks) => {
    const descriptor = message.conversationDispatch;
    if (!descriptor || descriptor.kind !== "canonical_conversation") {
      throw new Error("queued message is not a canonical conversation turn");
    }
    return await withCanonicalConversationTurnLock(
      descriptor.root,
      async () => {
        if (descriptor.root.authority === "org2-cloud") {
          return await dispatchQueuedCloudConversation(
            store,
            message,
            descriptor.root,
            callbacks
          );
        }
        return await dispatchQueuedLocalConversation(store, message, callbacks);
      }
    );
  };
