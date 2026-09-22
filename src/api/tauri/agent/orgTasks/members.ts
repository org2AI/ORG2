import { invokeTauri } from "@src/util/platform/tauri/init";

import { publishAgentOrgStateChange } from "./stateChanges";

export interface AgentOrgMemberIntervention {
  interventionReceiptId: string;
  orgRunId: string;
  memberId: string;
  agentId: string;
  sessionId: string;
  status: "yield_requested" | "active" | "return_requested";
  sourceEventId: string;
  originalTaskId?: string | null;
  originalTurnIntentId?: string | null;
  queuedUserDirectedCount: number;
  enteredAt: string;
  lastUserActivityAt: string;
  yieldRequestedAt?: string | null;
  yieldReleasedAt?: string | null;
  yieldTimedOutAt?: string | null;
  failureReason?: string | null;
  clearedAt?: string | null;
}

export type ReturnToWorkOutcome =
  | "restored_task"
  | "cleared_paused"
  | "cleared_idle"
  | "no_longer_needed"
  | "already_applied";

export type AppliedReturnToWorkOutcome = Exclude<
  ReturnToWorkOutcome,
  "already_applied"
>;

export interface ReturnToWorkResult {
  outcome: ReturnToWorkOutcome;
  appliedOutcome: AppliedReturnToWorkOutcome;
  hadOriginalFormalWork: boolean;
  interventionReceiptId: string;
  requestId: string;
  clearedRevision: number;
  clearedAt: string;
  continuationTurnIntentId?: string | null;
}

export interface AgentOrgOwnerRuntime {
  agentDefinitionId?: string | null;
  cliAgentType?: string | null;
  memberId?: string | null;
  sessionId: string;
  parentSessionId?: string | null;
  status: string;
  updatedAt: string;
  intervention?: AgentOrgMemberIntervention | null;
}

export interface AgentOrgRunContextMember {
  memberId: string;
  name: string;
  role: string;
  agentId: string;
}

export interface AgentOrgRunMemberView {
  memberId: string;
  name: string;
  role: string;
  agentId: string;
  isCoordinator: boolean;
  writerCapable: boolean;
  sessionRuntime?: AgentOrgOwnerRuntime | null;
  unreadInboxCount: number;
  inboxActivityCount: number;
  activeTaskCount: number;
  pendingTaskCount: number;
  inProgressTaskCount: number;
  completedTaskCount: number;
  queuedUserDirectedCount: number;
  activity?: {
    kind: "yielding" | "user_intervention" | "side_quest" | "yield_timeout";
    source: "direct_member";
    interventionReceiptId: string;
  } | null;
  intervention?: AgentOrgMemberIntervention | null;
}

export async function returnAgentOrgSessionToWork(
  sessionId: string,
  interventionReceiptId: string,
  requestId: string
): Promise<ReturnToWorkResult> {
  const result = await invokeTauri<ReturnToWorkResult>(
    "agent_org_session_return_to_work",
    {
      sessionId,
      interventionReceiptId,
      requestId,
    }
  );
  publishAgentOrgStateChange(sessionId);
  return result;
}
