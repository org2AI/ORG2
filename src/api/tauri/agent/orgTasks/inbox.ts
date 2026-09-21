export interface AgentOrgInboxPreviewRow {
  id: number;
  recipientAgentId: string;
  recipientMemberId?: string | null;
  senderAgentId: string;
  senderMemberId?: string | null;
  recipientName: string;
  senderName: string;
  displayText: string;
  orgRunId?: string | null;
  payloadKind: string;
  requestId?: string | null;
  createdAt: string;
  readAt?: string | null;
  deliveryResolution?: "cancelled" | "superseded" | null;
}

export interface AgentOrgInboxRuntimeRow extends AgentOrgInboxPreviewRow {
  /** Full durable payload returned only by explicit message/debug surfaces. */
  payloadJson: string;
}
