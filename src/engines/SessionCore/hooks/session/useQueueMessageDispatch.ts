/**
 * Per-message dispatch for the window-store queue dispatcher: the ordinary
 * concrete-session send, the canonical-conversation handoff into a durable
 * active delivery, and the shared failure settlement that returns a message
 * to the queue held for explicit dispatch.
 */
import type { Store } from "jotai/vanilla/store";
import { type MutableRefObject, useCallback } from "react";

import { Message } from "@src/components/Message";
import {
  type AgentExecMode,
  resolveSessionAgentExecMode,
} from "@src/config/sessionCreatorConfig";
import {
  dispatchUserIntent,
  setOptimisticQueueUserDelivery,
} from "@src/engines/SessionCore/services/userIntentDispatch";
import { createLogger } from "@src/hooks/logger";
import { lastUserMessageAtom } from "@src/store/session/cliSessionStatusAtom";
import {
  type LastModelSelection,
  creatorDefaultModelSelectionAtom,
} from "@src/store/session/creatorDefaultModelAtom";
import { sessionMapAtom } from "@src/store/session/sessionAtom";
import {
  type ActiveMessageDelivery,
  type QueuedMessage,
  messageQueueAtom,
  messageQueueHandoffIdsAtom,
} from "@src/store/ui/messageQueueAtom";
import { persistDurableMessageQueue } from "@src/store/ui/messageQueueRepository";
import { resolveModelForMessage } from "@src/util/session/resolveModelForMessage";
import { selectionFromSession } from "@src/util/session/selectionFromSession";

import { handoffQueuedMessageToActiveDelivery } from "./messageQueuePersistence";
import { optimisticDeliveryProjectionParams } from "./queueDispatchHelpers";

const log = createLogger("useQueueDispatch");

interface QueueMessageDispatchParams {
  store: Store;
  /** Send Now interrupt bookkeeping: one boundary interrupt per message. */
  interruptRequestedByMessageIdRef: MutableRefObject<Set<string>>;
  tryDispatchNextRef: MutableRefObject<() => void>;
}

export function useQueueMessageDispatch({
  store,
  interruptRequestedByMessageIdRef,
  tryDispatchNextRef,
}: QueueMessageDispatchParams) {
  const acceptQueuedMessage = useCallback(
    (messageId: string) => {
      interruptRequestedByMessageIdRef.current.delete(messageId);
      store.set(messageQueueAtom, (current) =>
        current.filter((candidate) => candidate.id !== messageId)
      );
    },
    [interruptRequestedByMessageIdRef, store]
  );

  const settleQueuedMessageFailure = useCallback(
    async (message: QueuedMessage, error: unknown) => {
      // The durable delivery record remains the retry/edit owner until an
      // accepted send retires it. EventStore is only its transcript
      // projection; transferring ownership to that cache made failed rows
      // disappear after a restart or imported-history refresh.
      if (message.conversationDispatch) {
        try {
          await setOptimisticQueueUserDelivery(
            optimisticDeliveryProjectionParams(message),
            "failed",
            error
          );
        } catch (projectionError) {
          log.error(
            "[useQueueDispatch] could not fail canonical transcript row:",
            projectionError
          );
        }
      }
      const detail = error instanceof Error ? error.message : String(error);
      store.set(messageQueueAtom, (current) =>
        current.some((candidate) => candidate.id === message.id)
          ? current.map((candidate) =>
              candidate.id === message.id
                ? {
                    ...candidate,
                    status: "queued",
                    priority: "next",
                    requiresExplicitDispatch: true,
                    deliveryError: detail,
                  }
                : candidate
            )
          : [
              ...current,
              {
                ...message,
                status: "queued",
                priority: "next",
                requiresExplicitDispatch: true,
                deliveryError: detail,
              },
            ]
      );
      interruptRequestedByMessageIdRef.current.delete(message.id);
      Message.error({
        content: `Failed to send message: ${detail}`,
        duration: 5000,
      });
    },
    [interruptRequestedByMessageIdRef, store]
  );

  const dispatchMessage = useCallback(
    (msg: QueuedMessage, onDone: () => void) => {
      const { sessionId, content, displayContent, imageDataUrls } = msg;

      // Snapshot-first model/mode resolution: the QueuedMessage carries the
      // selection frozen at enqueue time; the session-row + creator-default
      // chain only covers legacy entries enqueued before snapshots existed.
      const sessionMap = store.get(sessionMapAtom);
      const session = sessionMap.get(sessionId);
      const lastModelSelection: LastModelSelection | null =
        msg.modelSelection ??
        selectionFromSession(
          session,
          store.get(creatorDefaultModelSelectionAtom)
        );
      const agentExecMode: AgentExecMode =
        msg.agentExecMode ??
        resolveSessionAgentExecMode(session?.agentExecMode);
      const { model, accountId } = resolveModelForMessage(lastModelSelection);

      // Capture the payload for Stop-restore before the async append.
      store.set(lastUserMessageAtom, {
        sessionId,
        displayContent,
        imageDataUrls,
      });

      void (async () => {
        try {
          // Pass displayContent as displayText when it differs from content
          // (i.e. skill pills were expanded) so the persisted event stores
          // the pill format and re-editing shows the pill, not the YAML.
          const displayTextForDispatch =
            content !== displayContent ? displayContent : undefined;
          await dispatchUserIntent({
            sessionId,
            visibleText: displayContent,
            imageDataUrls,
            runtimeStatusSource: "queue",
            queueMessageId: msg.id,
            send: {
              content,
              displayText: displayTextForDispatch,
              model,
              accountId,
              mode: agentExecMode,
              clientMessageId: `queued:${sessionId}:${msg.id}`,
              turnIntentId: msg.turnIntentId,
              turnIntentSource: msg.priority === "now" ? "force_send" : "queue",
              directUserIntent: true,
            },
          });
          acceptQueuedMessage(msg.id);
        } catch (err) {
          log.error("[useQueueDispatch] dispatch failed:", err);
          await settleQueuedMessageFailure(msg, err);
        } finally {
          onDone();
        }
      })().catch((error: unknown) => {
        log.error("Queued dispatch settlement failed", error);
      });
    },
    [acceptQueuedMessage, settleQueuedMessageFailure, store]
  );

  const dispatchCanonicalMessage = useCallback(
    (msg: QueuedMessage, onDone: () => void) => {
      if (!msg.conversationDispatch) {
        onDone();
        return;
      }
      const delivery: ActiveMessageDelivery = {
        ...msg,
        conversationDispatch: msg.conversationDispatch,
        status: "preparing",
      };
      store.set(messageQueueHandoffIdsAtom, (current: ReadonlySet<string>) => {
        const next = new Set(current);
        next.add(msg.id);
        return next;
      });
      void persistDurableMessageQueue(store.get(messageQueueAtom))
        .then(() => handoffQueuedMessageToActiveDelivery(store, delivery))
        .then(() => {
          tryDispatchNextRef.current();
        })
        .catch((error) => settleQueuedMessageFailure(msg, error))
        .finally(() => {
          store.set(
            messageQueueHandoffIdsAtom,
            (current: ReadonlySet<string>) => {
              if (!current.has(msg.id)) return current;
              const next = new Set(current);
              next.delete(msg.id);
              return next;
            }
          );
          onDone();
        });
    },
    [settleQueuedMessageFailure, store, tryDispatchNextRef]
  );

  return {
    settleQueuedMessageFailure,
    dispatchMessage,
    dispatchCanonicalMessage,
  };
}
