import { selectAtom } from "jotai/utils";

import { conversationRootKey } from "@src/engines/SessionCore/conversations/conversationTypes";
import {
  type ActiveMessageDelivery,
  activeMessageDeliveriesAtom,
} from "@src/store/ui/messageQueueAtom";

export interface ConversationDeliveryScope {
  cloudRootKey: string | null;
  cloudIdentityKey: string | null;
  localRootKey: string | null;
}

function activeDeliveriesEqual(
  left: readonly ActiveMessageDelivery[],
  right: readonly ActiveMessageDelivery[]
): boolean {
  return (
    left.length === right.length &&
    left.every((delivery, index) => delivery === right[index])
  );
}

export function selectConversationActiveDeliveries(
  deliveries: readonly ActiveMessageDelivery[],
  scope: ConversationDeliveryScope
): ActiveMessageDelivery[] {
  return deliveries.filter((delivery) => {
    const descriptor = delivery.conversationDispatch;
    const rootKey = conversationRootKey(descriptor.root);
    if (scope.localRootKey && rootKey === scope.localRootKey) return true;
    return Boolean(
      scope.cloudRootKey &&
      scope.cloudIdentityKey &&
      rootKey === scope.cloudRootKey &&
      descriptor.dispatchIdentityKey === scope.cloudIdentityKey
    );
  });
}

export function conversationActiveDeliveriesAtom(
  scope: ConversationDeliveryScope
) {
  return selectAtom(
    activeMessageDeliveriesAtom,
    (deliveries) => selectConversationActiveDeliveries(deliveries, scope),
    activeDeliveriesEqual
  );
}

export interface ConversationActiveRunner {
  runnerSessionId: string;
  turnId: string;
  eventStartIndex: number;
}

export function selectConversationActiveRunners(
  deliveries: readonly ActiveMessageDelivery[],
  scope: ConversationDeliveryScope & { landedTurnIds: ReadonlySet<string> }
): ConversationActiveRunner[] {
  return deliveries.flatMap((delivery) => {
    const descriptor = delivery.conversationDispatch;
    const rootKey = conversationRootKey(descriptor.root);
    const isLocal = Boolean(
      scope.localRootKey && rootKey === scope.localRootKey
    );
    const isCloud = Boolean(
      scope.cloudRootKey &&
      scope.cloudIdentityKey &&
      rootKey === scope.cloudRootKey &&
      descriptor.dispatchIdentityKey === scope.cloudIdentityKey
    );
    if (
      (!isLocal && !isCloud) ||
      (isCloud && scope.landedTurnIds.has(delivery.turnIntentId)) ||
      !delivery.runnerSessionId ||
      delivery.runnerEventStartIndex === undefined
    ) {
      return [];
    }
    return [
      {
        runnerSessionId: delivery.runnerSessionId,
        turnId: delivery.turnIntentId,
        eventStartIndex: delivery.runnerEventStartIndex,
      },
    ];
  });
}
