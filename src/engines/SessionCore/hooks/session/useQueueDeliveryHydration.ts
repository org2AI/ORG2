/**
 * Durable-queue hydration and delivery-projection refresh effects for the
 * window-store queue dispatcher. Mounted once per window store by
 * useQueueDispatch; declaration order there is preserved so hydration still
 * runs before the focus/online refresh listeners attach.
 */
import type { Store } from "jotai/vanilla/store";
import { type MutableRefObject, useEffect } from "react";

import { createLogger } from "@src/hooks/logger";
import { messageQueueHydratedAtom } from "@src/store/ui/messageQueueAtom";
import { getMessageQueueOwnerKey } from "@src/store/ui/messageQueueRepository";

import {
  disposeMessageQueuePersistence,
  hydrateMessageQueue,
  refreshMessageDeliveries,
} from "./messageQueuePersistence";
import {
  CANONICAL_HYDRATION_RETRY_MAX_MS,
  QUEUE_BACKEND_RECHECK_MS,
} from "./queueDispatchHelpers";

const log = createLogger("useQueueDispatch");

export function useQueueDeliveryHydration(
  store: Store,
  messageQueueOwnerKeyRef: MutableRefObject<string | null>
): void {
  useEffect(() => {
    let disposed = false;
    let hydrationRetryTimer: number | null = null;
    let hydrationAttempt = 0;
    const recoverDelivery = async (): Promise<void> => {
      try {
        messageQueueOwnerKeyRef.current = await getMessageQueueOwnerKey();
        await hydrateMessageQueue(store);
      } catch (error) {
        log.error(
          "[useQueueDispatch] delivery recovery hydration failed closed:",
          error
        );
        if (!disposed) {
          hydrationAttempt += 1;
          const delay = Math.min(
            QUEUE_BACKEND_RECHECK_MS * 2 ** (hydrationAttempt - 1),
            CANONICAL_HYDRATION_RETRY_MAX_MS
          );
          hydrationRetryTimer = window.setTimeout(() => {
            hydrationRetryTimer = null;
            void recoverDelivery().catch((error: unknown) => {
              log.error("Delivery recovery callback failed", error);
            });
          }, delay);
        }
      }
    };
    void recoverDelivery().catch((error: unknown) => {
      log.error("Delivery recovery callback failed", error);
    });
    return () => {
      disposed = true;
      if (hydrationRetryTimer !== null) {
        window.clearTimeout(hydrationRetryTimer);
      }
      disposeMessageQueuePersistence(store);
    };
  }, [messageQueueOwnerKeyRef, store]);
}

export function useQueueDeliveryRefresh(store: Store): void {
  useEffect(() => {
    let refreshInFlight: Promise<void> | null = null;
    let trailingRefresh = false;
    const refreshDeliveryProjection = () => {
      if (!store.get(messageQueueHydratedAtom)) return;
      if (refreshInFlight) {
        trailingRefresh = true;
        return;
      }
      refreshInFlight = (async () => {
        do {
          trailingRefresh = false;
          await refreshMessageDeliveries(store);
        } while (trailingRefresh);
      })()
        .catch((error) =>
          log.warn(
            "[useQueueDispatch] failed to refresh delivery projection:",
            error
          )
        )
        .finally(() => {
          refreshInFlight = null;
        });
    };
    const refreshIfVisible = () => {
      if (
        typeof document === "undefined" ||
        document.visibilityState === "visible"
      ) {
        refreshDeliveryProjection();
      }
    };
    window.addEventListener("focus", refreshIfVisible);
    window.addEventListener("online", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      window.removeEventListener("focus", refreshIfVisible);
      window.removeEventListener("online", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [store]);
}
