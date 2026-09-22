/** Sender-local proof for explicit retries. Cloud audit rows stay unchanged. */
import { rpc } from "@src/api/tauri/rpc";
import {
  type QueuedConversationExecutionMessage,
  QueuedConversationRecoveryPendingError,
} from "@src/engines/SessionCore/conversations/queuedConversationContract";
import {
  type QueuedRetryLineage,
  beginQueuedRetry,
  recordEmptyFailedAttempt,
  retryLineageEvent,
  retryLineageEventId,
  retryLineageForMessage,
} from "@src/engines/SessionCore/conversations/queuedRetryLineage";
import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import { loadAuthoritativeSessionEvents } from "@src/engines/SessionCore/sync/authoritativeSessionEvents";

export interface CloudConversationRetry {
  message: QueuedConversationExecutionMessage;
  lineage: QueuedRetryLineage;
}

export async function prepareCloudConversationRetry(
  message: QueuedConversationExecutionMessage
): Promise<CloudConversationRetry> {
  try {
    // Cloud owns ordering; execution already requires this sender's native
    // runtime. Its exact local proof is never inferred from remote metadata.
    const persisted = await rpc.sessionCore.cache.getEvent({
      sessionId: message.sessionId,
      eventId: retryLineageEventId(message.id),
    });
    const previous = retryLineageForMessage(
      persisted ? [persisted] : [],
      message
    );
    const lineage = beginQueuedRetry(previous, message);
    if (lineage !== previous) {
      await eventStoreProxy.append(
        [retryLineageEvent(message.sessionId, lineage)],
        message.sessionId
      );
    }
    return { message, lineage };
  } catch (error) {
    // A preparing row with a runner can have crossed native acceptance just
    // before its frontend receipt persisted. Never demote that owner because
    // this new lineage read/write is unavailable; recover the same intent.
    if (message.runnerSessionId || message.status === "accepted") {
      throw new QueuedConversationRecoveryPendingError(
        `Could not load retry lineage: ${String(error)}`
      );
    }
    throw error;
  }
}

/** A portable empty tail alone cannot prove that no tool/reasoning ran. */
export async function persistCloudEmptyFailure(
  retry: CloudConversationRetry,
  runnerSessionId: string
): Promise<boolean> {
  try {
    const native = await loadAuthoritativeSessionEvents(runnerSessionId);
    let lineage: QueuedRetryLineage;
    try {
      lineage = recordEmptyFailedAttempt(
        retry.lineage,
        retry.message,
        native.events
      );
    } catch {
      // A tool, private reasoning, partial reply or another turn in the raw
      // suffix makes this a normal failed turn, never an empty retry proof.
      return false;
    }
    if (lineage.failed?.turnIntentId !== retry.message.turnIntentId)
      return false;
    await eventStoreProxy.append(
      [retryLineageEvent(retry.message.sessionId, lineage)],
      retry.message.sessionId
    );
    retry.lineage = lineage;
    return true;
  } catch (error) {
    // Keep the accepted owner while its native proof/save is unavailable.
    // Recovery reconnects to this intent; it must never charge a second call.
    throw new QueuedConversationRecoveryPendingError(
      `Could not persist failed-attempt lineage: ${String(error)}`
    );
  }
}
