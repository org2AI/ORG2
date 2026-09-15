import type { AgentOrgGroupDeliveryInput } from "@src/api/tauri/agent";

export interface GroupChatRetryEnvelope {
  fingerprint: string;
  deliveries: AgentOrgGroupDeliveryInput[];
  content: string;
  displayText: string;
  images?: string[];
  targetMemberNames: string[];
}

export function groupChatRetryRequest(envelope: GroupChatRetryEnvelope): {
  deliveries: AgentOrgGroupDeliveryInput[];
  content: string;
  displayText: string;
  images?: string[];
} {
  return {
    deliveries: envelope.deliveries.map((delivery) => ({ ...delivery })),
    content: envelope.content,
    displayText: envelope.displayText,
    images: envelope.images?.slice(),
  };
}

export function isDurableGroupDeliveryOutcomeUnknown(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("group_delivery_commit_before_kick_fault") ||
    message.includes("group_delivery_response_loss_after_kick_fault") ||
    message.includes("group_delivery_kick_failed")
  );
}

export function isGroupRetryEnvelopeDurable(
  envelope: GroupChatRetryEnvelope,
  durableTurnIds: ReadonlySet<string>
): boolean {
  return envelope.deliveries.every((delivery) =>
    durableTurnIds.has(delivery.turnIntentId)
  );
}
