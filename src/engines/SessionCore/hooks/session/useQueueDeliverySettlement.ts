/**
 * Settlement primitives for durable active deliveries: bounded retry
 * scheduling, failing the optimistic canonical transcript row, and returning
 * a failed delivery to the queue as an explicit-dispatch retry.
 */
import type { Store } from "jotai/vanilla/store";
import { useCallback } from "react";

import { setOptimisticQueueUserDelivery } from "@src/engines/SessionCore/services/userIntentDispatch";
import { createLogger } from "@src/hooks/logger";
import {
  type ActiveMessageDelivery,
  activeMessageDeliveriesAtom,
} from "@src/store/ui/messageQueueAtom";

import {
  returnActiveDeliveryToMessageQueue,
  updateActiveMessageDelivery,
} from "./messageQueuePersistence";
import {
  canonicalRecoveryDelayMs,
  optimisticDeliveryProjectionParams,
  queuedRetryFromDelivery,
} from "./queueDispatchHelpers";

const log = createLogger("useQueueDispatch");

export function useQueueDeliverySettlement(store: Store) {
  const retryActiveDelivery = useCallback(
    async (delivery: ActiveMessageDelivery) => {
      const attempt = (delivery.retryAttempt ?? 0) + 1;
      await updateActiveMessageDelivery(store, delivery.id, {
        retryAttempt: attempt,
        retryAt: new Date(
          Date.now() + canonicalRecoveryDelayMs(attempt)
        ).toISOString(),
      });
    },
    [store]
  );

  const projectActiveCanonicalFailure = useCallback(
    async (
      delivery: ActiveMessageDelivery,
      error: unknown
    ): Promise<boolean> => {
      let projected = false;
      try {
        projected = await setOptimisticQueueUserDelivery(
          optimisticDeliveryProjectionParams(delivery),
          "failed",
          error
        );
      } catch (projectionError) {
        log.error(
          "[useQueueDispatch] could not fail canonical transcript row:",
          projectionError
        );
        return false;
      }
      return projected;
    },
    []
  );

  const returnFailedCanonicalDeliveryToQueue = useCallback(
    async (
      delivery: ActiveMessageDelivery,
      error?: unknown
    ): Promise<boolean> => {
      try {
        await returnActiveDeliveryToMessageQueue(
          store,
          delivery.id,
          queuedRetryFromDelivery(delivery, error)
        );
        return true;
      } catch (returnError) {
        log.error(
          "[useQueueDispatch] could not restore failed queue row:",
          returnError
        );
        const current = store
          .get(activeMessageDeliveriesAtom)
          .find((candidate) => candidate.id === delivery.id);
        if (current) await retryActiveDelivery(current);
        return false;
      }
    },
    [retryActiveDelivery, store]
  );

  return {
    retryActiveDelivery,
    projectActiveCanonicalFailure,
    returnFailedCanonicalDeliveryToQueue,
  };
}
