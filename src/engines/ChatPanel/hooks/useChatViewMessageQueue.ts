import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useMemo } from "react";

import type { ConversationRootLocator } from "@src/engines/SessionCore/conversations/conversationTypes";
import { conversationRootKey } from "@src/engines/SessionCore/conversations/conversationTypes";
import {
  type QueuedMessage,
  clearQueuedMessagesAtom,
  dequeueMessageAtom,
  editMessageAtom,
  forceSendMessageAtom,
  messageQueueAtom,
  reorderQueueAtom,
} from "@src/store/ui/messageQueueAtom";

import { useQueueEditMode } from "../InputArea/hooks/useQueueEditMode";

/** Keeps queue filtering and global-index reordering consistent for ChatView. */
export function queuedMessageBelongsToConversationView(
  message: QueuedMessage,
  params: {
    pipelineSessionId: string | null;
    queueSessionId: string | null;
    conversationRoot: ConversationRootLocator | null;
  }
): boolean {
  if (
    message.sessionId === params.queueSessionId ||
    message.sessionId === params.pipelineSessionId
  ) {
    return true;
  }
  return Boolean(
    params.conversationRoot &&
    message.conversationDispatch &&
    conversationRootKey(message.conversationDispatch.root) ===
      conversationRootKey(params.conversationRoot)
  );
}

export function useChatViewMessageQueue({
  pipelineSessionId,
  queueSessionId,
  conversationRoot,
}: {
  pipelineSessionId: string | null;
  queueSessionId: string | null;
  conversationRoot: ConversationRootLocator | null;
}) {
  const messageQueue = useAtomValue(messageQueueAtom);
  const sessionMessageQueue = useMemo(
    () =>
      messageQueue.filter(
        (message) =>
          // preparing/accepted are crash-recovery records, not composer queue
          // cards. Their user row and ordinary planning/working footer already
          // render in the transcript once dispatch begins.
          message.status === "queued" &&
          queuedMessageBelongsToConversationView(message, {
            pipelineSessionId,
            queueSessionId,
            conversationRoot,
          })
      ),
    [conversationRoot, messageQueue, pipelineSessionId, queueSessionId]
  );
  const cancelQueuedMessage = useSetAtom(dequeueMessageAtom);
  const clearQueuedMessages = useSetAtom(clearQueuedMessagesAtom);
  const editQueuedMessage = useSetAtom(editMessageAtom);
  const reorderQueue = useSetAtom(reorderQueueAtom);
  const forceSendQueuedMessage = useSetAtom(forceSendMessageAtom);
  const queueTailKey = sessionMessageQueue.at(-1)?.turnIntentId ?? null;

  const handleSendNow = useCallback(
    (messageId: string) => {
      const message = messageQueue.find((item) => item.id === messageId);
      if (!message) return;
      forceSendQueuedMessage(messageId);
    },
    [messageQueue, forceSendQueuedMessage]
  );

  const handleCommitQueueEdit = useCallback(
    (messageId: string, content: string, imageDataUrls?: string[]) => {
      return editQueuedMessage({ messageId, content, imageDataUrls });
    },
    [editQueuedMessage]
  );

  const handleReorderSessionQueue = useCallback(
    (fromIndex: number, toIndex: number) => {
      const fromMessage = sessionMessageQueue[fromIndex];
      const toMessage = sessionMessageQueue[toIndex];
      if (!fromMessage || !toMessage) return;
      const globalFromIndex = messageQueue.findIndex(
        (message) => message.id === fromMessage.id
      );
      const globalToIndex = messageQueue.findIndex(
        (message) => message.id === toMessage.id
      );
      reorderQueue({ fromIndex: globalFromIndex, toIndex: globalToIndex });
    },
    [messageQueue, reorderQueue, sessionMessageQueue]
  );

  const handleClearSessionQueue = useCallback(() => {
    clearQueuedMessages(sessionMessageQueue.map((message) => message.id));
  }, [clearQueuedMessages, sessionMessageQueue]);

  const queueEditProps = useQueueEditMode({
    onCommit: handleCommitQueueEdit,
    onCommitSendNow: handleSendNow,
  });

  return {
    cancelQueuedMessage,
    queueTailKey,
    handleClearSessionQueue,
    handleReorderSessionQueue,
    handleSendNow,
    queueEditProps,
    sessionMessageQueue,
  };
}
