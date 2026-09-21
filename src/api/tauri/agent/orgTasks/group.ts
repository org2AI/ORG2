import { invokeTauri } from "@src/util/platform/tauri/init";

import type { AgentOrgInboxRuntimeRow } from "./inbox";
import { publishAgentOrgStateChange } from "./stateChanges";

export interface AgentOrgGroupDeliveryInput {
  targetMemberId: string;
  turnIntentId: string;
}

export interface AgentOrgGroupDeliveryResponse {
  targetMemberId: string;
  targetMemberName: string;
  turnIntentId: string;
  sourceInboxId: number;
  memberDispatchSequence: number;
  outcome: "accepted" | "existing";
  inboxRow: AgentOrgInboxRuntimeRow;
}

export interface AgentOrgGroupChatMessageResponse {
  deliveries: AgentOrgGroupDeliveryResponse[];
}

export type AgentOrgGroupRoute = "coordinator" | "member";
export type AgentOrgGroupConversationKind = "user_message" | "assistant_reply";
export type AgentOrgGroupDisplayState =
  | "queued"
  | "running"
  | "answered"
  | "failed"
  | "cancelled"
  | "unknown";
export type AgentOrgGroupRetryMode =
  | "rekick"
  | "new_turn"
  | "new_turn_with_confirmation";

export interface AgentOrgGroupOrderKey {
  createdAt: string;
  sourceRank: number;
  stableSourceId: string;
  itemOrdinal: number;
}

export type AgentOrgGroupSourceRef =
  | { kind: "event"; id: string }
  | { kind: "inbox"; id: number }
  | { kind: "initial_input"; id: string };

export interface AgentOrgGroupConversationItem {
  id: string;
  kind: AgentOrgGroupConversationKind;
  order: AgentOrgGroupOrderKey;
  turnIntentId: string;
  route: AgentOrgGroupRoute;
  targetMemberId: string;
  targetName: string;
  responderMemberId?: string;
  responderName?: string;
  sourceRef: AgentOrgGroupSourceRef;
  replyToItemId?: string;
  text: string;
  createdAt: string;
  state?: AgentOrgGroupDisplayState;
  errorCode?: string;
  canStop: boolean;
  retryMode?: AgentOrgGroupRetryMode;
}

export type AgentOrgGroupActivityKind =
  | "task_created"
  | "task_started"
  | "task_completed"
  | "task_failed"
  | "task_cancelled"
  | "task_reassigned"
  | "task_replacement_created"
  | "team_paused"
  | "team_resumed"
  | "member_returned"
  | "completion_certified"
  | "final_report_failed"
  | "team_archived";

export interface AgentOrgGroupActivityItem {
  id: string;
  kind: "team_activity";
  order: AgentOrgGroupOrderKey;
  activityKind: AgentOrgGroupActivityKind;
  createdAt: string;
  memberId?: string;
  memberName?: string;
  previousMemberId?: string;
  previousMemberName?: string;
  taskId?: string;
  taskSubject?: string;
  replacedTaskId?: string;
  replacedTaskSubject?: string;
  outcome?: string;
  publicErrorCode?: string;
}

export interface AgentOrgGroupDiagnosticItem {
  id: string;
  kind: "diagnostic";
  order: AgentOrgGroupOrderKey;
  createdAt: string;
  errorCode: string;
}

export type AgentOrgGroupProjectionItem =
  | AgentOrgGroupConversationItem
  | AgentOrgGroupActivityItem
  | AgentOrgGroupDiagnosticItem;

export function isAgentOrgGroupConversationItem(
  item: AgentOrgGroupProjectionItem
): item is AgentOrgGroupConversationItem {
  return item.kind === "user_message" || item.kind === "assistant_reply";
}

export interface AgentOrgGroupProjectionPage {
  runId: string;
  items: AgentOrgGroupProjectionItem[];
  hasMore: boolean;
  nextCursor?: string;
}

export interface AgentOrgGroupRootMessageResponse {
  turnIntentId: string;
  targetMemberId: string;
  targetName: string;
}

export interface AgentOrgGroupStopResponse {
  turnIntentId: string;
  outcome: "queued_cancelled" | "cancellation_requested" | "already_terminal";
}

export interface AgentOrgGroupRetryResponse {
  sourceTurnIntentId: string;
  turnIntentId: string;
  outcome: "rekicked" | "created";
}

export async function getAgentOrgGroupProjectionPage(input: {
  sessionId: string;
  cursor?: string | null;
  limit?: number;
}): Promise<AgentOrgGroupProjectionPage> {
  return invokeTauri<AgentOrgGroupProjectionPage>(
    "agent_org_group_projection_page",
    {
      sessionId: input.sessionId,
      cursor: input.cursor ?? null,
      limit: input.limit ?? 50,
    }
  );
}

export async function sendAgentOrgGroupChatMessage(
  sessionId: string,
  deliveries: AgentOrgGroupDeliveryInput[],
  content: string,
  displayText?: string,
  images?: string[]
): Promise<AgentOrgGroupChatMessageResponse> {
  const response = await invokeTauri<AgentOrgGroupChatMessageResponse>(
    "agent_org_send_group_chat_message",
    {
      sessionId,
      deliveries,
      content,
      displayText: displayText ?? null,
      images: images?.length ? images : null,
    }
  );
  publishAgentOrgStateChange(sessionId);
  return response;
}

export async function sendAgentOrgGroupRootMessage(input: {
  sessionId: string;
  turnIntentId: string;
  clientMessageId: string;
  content: string;
  displayText?: string;
  images?: string[];
}): Promise<AgentOrgGroupRootMessageResponse> {
  const response = await invokeTauri<AgentOrgGroupRootMessageResponse>(
    "agent_org_send_group_root_message",
    {
      ...input,
      displayText: input.displayText ?? null,
      images: input.images?.length ? input.images : null,
    }
  );
  publishAgentOrgStateChange(input.sessionId);
  return response;
}

export async function stopAgentOrgGroupDelivery(input: {
  sessionId: string;
  turnIntentId: string;
}): Promise<AgentOrgGroupStopResponse> {
  const response = await invokeTauri<AgentOrgGroupStopResponse>(
    "agent_org_stop_group_delivery",
    input
  );
  publishAgentOrgStateChange(input.sessionId);
  return response;
}

export async function retryAgentOrgGroupDelivery(input: {
  sessionId: string;
  sourceTurnIntentId: string;
  retryTurnIntentId?: string;
  acknowledgePossibleDuplicate: boolean;
}): Promise<AgentOrgGroupRetryResponse> {
  const response = await invokeTauri<AgentOrgGroupRetryResponse>(
    "agent_org_retry_group_delivery",
    {
      ...input,
      retryTurnIntentId: input.retryTurnIntentId ?? null,
    }
  );
  publishAgentOrgStateChange(input.sessionId);
  return response;
}
