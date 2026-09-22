/**
 * Durable active-delivery runner for canonical conversations. Claims each
 * runnable delivery under its process-wide root lock, executes it through
 * the injected canonical dispatcher and settles every recovery verdict
 * without ever re-sending an already accepted provider turn.
 */
import type { Store } from "jotai/vanilla/store";
import { type MutableRefObject, useCallback, useRef } from "react";

import { Message } from "@src/components/Message";
import { conversationRootKey } from "@src/engines/SessionCore/conversations/conversationTypes";
import {
  QueuedConversationBlockedError,
  QueuedConversationBusyError,
  type QueuedConversationDispatcher,
  QueuedConversationRecoveryBlockedError,
  QueuedConversationRecoveryPendingError,
  QueuedConversationTurnClosedError,
  QueuedConversationTurnFailedError,
} from "@src/engines/SessionCore/conversations/queuedConversationContract";
import {
  isUserIntentSendError,
  setOptimisticQueueUserDelivery,
} from "@src/engines/SessionCore/services/userIntentDispatch";
import { createLogger } from "@src/hooks/logger";
import {
  activeMessageDeliveriesAtom,
  messageQueueHydratedAtom,
} from "@src/store/ui/messageQueueAtom";
import {
  isPrimaryMessageQueueOwnerKey,
  withCanonicalConversationTurnLock,
} from "@src/store/ui/messageQueueRepository";

import {
  assertDurableActiveDeliveryIsRootHead,
  refreshMessageDeliveries,
  removeActiveMessageDelivery,
  replaceActiveMessageDeliveryLocally,
  updateActiveMessageDelivery,
} from "./messageQueuePersistence";
import {
  QUEUE_BACKEND_RECHECK_MS,
  optimisticDeliveryProjectionParams,
} from "./queueDispatchHelpers";
import { useQueueDeliverySettlement } from "./useQueueDeliverySettlement";

const log = createLogger("useQueueDispatch");

interface QueueActiveDeliveriesParams {
  store: Store;
  executeCanonicalConversation: QueuedConversationDispatcher | undefined;
  messageQueueOwnerKeyRef: MutableRefObject<string | null>;
  scheduleWakeAt: (wakeAt: number) => void;
  tryDispatchNextRef: MutableRefObject<() => void>;
}

export function useQueueActiveDeliveries({
  store,
  executeCanonicalConversation,
  messageQueueOwnerKeyRef,
  scheduleWakeAt,
  tryDispatchNextRef,
}: QueueActiveDeliveriesParams): () => void {
  const activeDeliveryIdsRef = useRef<Set<string>>(new Set());

  const {
    retryActiveDelivery,
    projectActiveCanonicalFailure,
    returnFailedCanonicalDeliveryToQueue,
  } = useQueueDeliverySettlement(store);

  const startRunnableActiveDeliveries = useCallback(() => {
    if (!store.get(messageQueueHydratedAtom)) return;
    if (!executeCanonicalConversation) return;
    const now = Date.now();
    const deliveries = store.get(activeMessageDeliveriesAtom);
    const ownerKey = messageQueueOwnerKeyRef.current;
    if (!ownerKey) return;
    const claimedRoots = new Set<string>();
    for (const delivery of deliveries) {
      if (!activeDeliveryIdsRef.current.has(delivery.id)) continue;
      claimedRoots.add(conversationRootKey(delivery.conversationDispatch.root));
    }
    const runnable = deliveries.filter((delivery) => {
      if (activeDeliveryIdsRef.current.has(delivery.id)) return false;
      if (
        !isPrimaryMessageQueueOwnerKey(ownerKey) &&
        delivery.originQueueKey !== ownerKey
      ) {
        return false;
      }
      const rootKey = conversationRootKey(delivery.conversationDispatch.root);
      if (claimedRoots.has(rootKey)) return false;
      // Claim the durable FIFO head before evaluating its wake condition.
      // A blocked/backing-off head must prevent a later turn for the same
      // canonical root from materializing against a transcript missing it.
      claimedRoots.add(rootKey);
      const retryAt = Date.parse(delivery.retryAt ?? "");
      if (Number.isFinite(retryAt) && retryAt > now) return false;
      return true;
    });
    const nextRetryAt = deliveries.reduce<number | undefined>(
      (earliest, delivery) => {
        const retryAt = Date.parse(delivery.retryAt ?? "");
        if (!Number.isFinite(retryAt) || retryAt <= now) return earliest;
        return earliest === undefined || retryAt < earliest
          ? retryAt
          : earliest;
      },
      undefined
    );
    if (nextRetryAt !== undefined) scheduleWakeAt(nextRetryAt);

    for (const delivery of runnable) {
      const deliveryId = delivery.id;
      activeDeliveryIdsRef.current.add(deliveryId);
      void withCanonicalConversationTurnLock(
        delivery.conversationDispatch.root,
        async () => {
          // The atom only wakes the dispatcher. The durable row read under the
          // root lock is the sole launch authority and carries the latest
          // accepted/runner recovery metadata from every webview.
          const currentDelivery =
            await assertDurableActiveDeliveryIsRootHead(deliveryId);
          let accepted = currentDelivery.status === "accepted";
          const message = currentDelivery;
          await executeCanonicalConversation(store, message, {
            onRunnerReady: async (runnerSessionId, runnerEventStartIndex) => {
              await updateActiveMessageDelivery(store, currentDelivery.id, {
                runnerSessionId,
                runnerEventStartIndex,
                retryAt: undefined,
              });
            },
            onAccepted: async (runnerSessionId) => {
              accepted = true;
              await updateActiveMessageDelivery(store, currentDelivery.id, {
                status: "accepted",
                runnerSessionId,
                retryAt: undefined,
              });
              await setOptimisticQueueUserDelivery(
                optimisticDeliveryProjectionParams(currentDelivery),
                "sent"
              ).catch((projectionError) => {
                log.error(
                  "[useQueueDispatch] could not accept canonical transcript row:",
                  projectionError
                );
                return false;
              });
            },
          })
            .then(async () => {
              await removeActiveMessageDelivery(store, currentDelivery.id);
            })
            .catch(async (error: unknown) => {
              if (
                error instanceof QueuedConversationRecoveryBlockedError ||
                error instanceof QueuedConversationTurnClosedError
              ) {
                if (
                  !accepted &&
                  !(error instanceof QueuedConversationTurnClosedError)
                ) {
                  // A definitive pre-acceptance recovery verdict (for example,
                  // a restart-reconciled stale turn intent) is an ordinary
                  // failed send. Keep the user's row visible and retryable;
                  // only an already-accepted provider owner may be retired
                  // without returning it to the queue.
                  if (
                    !(await projectActiveCanonicalFailure(
                      currentDelivery,
                      error
                    ))
                  ) {
                    log.warn(
                      "[useQueueDispatch] failed recovery projection will be restored from delivery owner"
                    );
                  }
                  if (
                    !(await returnFailedCanonicalDeliveryToQueue(
                      currentDelivery,
                      error
                    ))
                  )
                    return;
                  Message.error({ content: error.message, duration: 5000 });
                  return;
                }
                // These terminal verdicts prove automatic recovery cannot run
                // the provider, including a Cloud-published startup failure.
                // Retire the execution owner without synthesizing a
                // retry of the already accepted intent; the durable provider/
                // Cloud failure row remains the visible terminal result. Mark
                // that row so an explicit Retry mints a fresh intent instead
                // of waiting for an owner that no longer exists.
                const retiredProjection = await setOptimisticQueueUserDelivery(
                  optimisticDeliveryProjectionParams(currentDelivery),
                  "failed",
                  error,
                  { ownerRetired: true }
                ).catch((projectionError) => {
                  log.error(
                    "[useQueueDispatch] could not mark retired canonical transcript row:",
                    projectionError
                  );
                  return false;
                });
                if (!retiredProjection) {
                  // Reconciliation may have replaced the exact optimistic id,
                  // or persistence may be unavailable. Until the failed row
                  // owns Retry, retain this accepted delivery and use its
                  // existing bounded recovery wake-up; never lose both owners.
                  const current = store
                    .get(activeMessageDeliveriesAtom)
                    .find((candidate) => candidate.id === currentDelivery.id);
                  if (current) await retryActiveDelivery(current);
                  return;
                }
                await removeActiveMessageDelivery(store, currentDelivery.id);
                Message.error({ content: error.message, duration: 5000 });
                return;
              }
              if (error instanceof QueuedConversationBlockedError) {
                if (accepted) {
                  // No adapter may demote an intent after the irreversible
                  // provider-acceptance boundary. Treat a late identity/account
                  // verdict as recovery work against the same native turn.
                  const current = store
                    .get(activeMessageDeliveriesAtom)
                    .find((candidate) => candidate.id === currentDelivery.id);
                  if (current) await retryActiveDelivery(current);
                  return;
                }
                // Admission failed before provider acceptance. The optimistic
                // EventStore row is already the visible retry/edit owner, so
                // fail that exact row rather than retracting it into a card.
                if (
                  !(await projectActiveCanonicalFailure(currentDelivery, error))
                ) {
                  log.warn(
                    "[useQueueDispatch] failed transcript projection will be restored from delivery owner"
                  );
                }
                if (
                  !(await returnFailedCanonicalDeliveryToQueue(
                    currentDelivery,
                    error
                  ))
                )
                  return;
                Message.error({
                  content: error.message,
                  duration: 5000,
                });
                return;
              }
              if (error instanceof QueuedConversationRecoveryPendingError) {
                // The canonical user event or provider acceptance boundary may
                // already be durable even when the result/tail cannot be read or
                // published yet. Keep this execution owner in place regardless
                // of its current phase and retry idempotent recovery only.
                log.error(
                  "[useQueueDispatch] canonical execution needs recovery:",
                  error
                );
                const current = store
                  .get(activeMessageDeliveriesAtom)
                  .find((candidate) => candidate.id === currentDelivery.id);
                if (current) await retryActiveDelivery(current);
                return;
              }
              if (error instanceof QueuedConversationTurnFailedError) {
                // The provider closed the accepted turn with a definitive
                // failure and no tail. The optimistic row is the visible retry
                // owner: fail it with the reason and hold it for an explicit
                // resend instead of reconnecting to a turn that cannot recover.
                if (
                  !(await projectActiveCanonicalFailure(currentDelivery, error))
                ) {
                  log.warn(
                    "[useQueueDispatch] failed transcript projection will be restored from delivery owner"
                  );
                }
                if (
                  !(await returnFailedCanonicalDeliveryToQueue(
                    currentDelivery,
                    error
                  ))
                )
                  return;
                Message.error({ content: error.message, duration: 5000 });
                return;
              }
              if (accepted) {
                // Acceptance is an irreversible boundary: the provider may have
                // executed tools even when recovery/tail staging later failed.
                // Retain this durable owner and reconnect to the SAME turn after a
                // bounded backoff. The adapter's accepted path is recovery-only;
                // it must never fall back to a fresh provider send.
                log.error(
                  "[useQueueDispatch] accepted canonical execution needs recovery:",
                  error
                );
                const current = store
                  .get(activeMessageDeliveriesAtom)
                  .find((candidate) => candidate.id === currentDelivery.id);
                if (!current) return;
                await retryActiveDelivery(current);
                return;
              }
              if (isUserIntentSendError(error)) {
                if (
                  !(await projectActiveCanonicalFailure(currentDelivery, error))
                )
                  log.warn(
                    "[useQueueDispatch] failed transcript projection will be restored from delivery owner"
                  );
                await returnFailedCanonicalDeliveryToQueue(
                  currentDelivery,
                  error
                );
                return;
              }
              if (
                !(await projectActiveCanonicalFailure(currentDelivery, error))
              )
                log.warn(
                  "[useQueueDispatch] failed transcript projection will be restored from delivery owner"
                );
              if (
                !(await returnFailedCanonicalDeliveryToQueue(
                  currentDelivery,
                  error
                ))
              )
                return;
              Message.error({
                content: `Failed to continue conversation: ${
                  error instanceof Error ? error.message : String(error)
                }`,
                duration: 5000,
              });
            })
            .catch((settlementError: unknown) => {
              // A failed retry/remove/return write must not become an unhandled
              // rejection followed by an immediate provider retry loop. Keep the
              // durable owner projected locally with a bounded wake; focus/online
              // reconciliation will re-read the authoritative document sooner if
              // storage recovers.
              log.error(
                "[useQueueDispatch] canonical settlement persistence failed:",
                settlementError
              );
              const retryAt = new Date(
                Date.now() + QUEUE_BACKEND_RECHECK_MS
              ).toISOString();
              replaceActiveMessageDeliveryLocally(store, currentDelivery.id, {
                retryAt,
              });
            });
        }
      )
        .catch(async (lockError: unknown) => {
          if (lockError instanceof QueuedConversationBusyError) {
            await refreshMessageDeliveries(store);
            const current = store
              .get(activeMessageDeliveriesAtom)
              .find((candidate) => candidate.id === delivery.id);
            if (current) await retryActiveDelivery(current);
            return;
          }
          log.error(
            "[useQueueDispatch] canonical root lock/claim failed:",
            lockError
          );
          const retryAt = new Date(
            Date.now() + QUEUE_BACKEND_RECHECK_MS
          ).toISOString();
          replaceActiveMessageDeliveryLocally(store, delivery.id, { retryAt });
        })
        .finally(() => {
          activeDeliveryIdsRef.current.delete(delivery.id);
          tryDispatchNextRef.current();
        });
    }
  }, [
    executeCanonicalConversation,
    messageQueueOwnerKeyRef,
    projectActiveCanonicalFailure,
    returnFailedCanonicalDeliveryToQueue,
    retryActiveDelivery,
    scheduleWakeAt,
    store,
    tryDispatchNextRef,
  ]);

  return startRunnableActiveDeliveries;
}
