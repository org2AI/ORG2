import { invokeTauri } from "@src/util/platform/tauri/init";

export interface AgentOrgPlanTaskOutputRef {
  taskId: string;
  planRevisionId: string;
  producedByMemberId: string;
  producedAt: string;
}

export interface AgentOrgPlanRevisionSummary {
  approvalId: string;
  planRevisionId: string;
  revisionNumber: number;
  previousPlanRevisionId?: string | null;
  requestId: string;
  orgRunId: string;
  sourceTaskId: string;
  sourceMemberId: string;
  sourceSessionId: string;
  sourceTurnIntentId: string;
  rootSessionId: string;
  policy: "coordinator" | "user" | "automatic";
  status:
    | "pending"
    | "approved"
    | "changes_requested"
    | "superseded"
    | "cancelled";
  planTitle: string;
  planContentBytes: number;
  contentDigest: string;
  decisionBy?: "user" | "coordinator" | "automatic" | "system" | null;
  feedback?: string | null;
  taskOutput?: AgentOrgPlanTaskOutputRef | null;
  createdAt: string;
  resolvedAt?: string | null;
}

/** @deprecated Use AgentOrgPlanRevisionSummary. */
export type AgentOrgPlanApprovalSummary = AgentOrgPlanRevisionSummary;

export interface AgentOrgPlanRevision {
  approvalId: string;
  planRevisionId: string;
  revisionNumber: number;
  previousPlanRevisionId?: string | null;
  requestId: string;
  orgRunId: string;
  sourceTaskId: string;
  sourceMemberId: string;
  sourceSessionId: string;
  sourceTurnIntentId: string;
  rootSessionId: string;
  policy: "coordinator" | "user" | "automatic";
  status:
    | "pending"
    | "approved"
    | "changes_requested"
    | "superseded"
    | "cancelled";
  planTitle: string;
  planPath: string;
  planContent: string;
  contentDigest: string;
  decisionBy?: "user" | "coordinator" | "automatic" | "system" | null;
  feedback?: string | null;
  taskOutput?: AgentOrgPlanTaskOutputRef | null;
  createdAt: string;
  resolvedAt?: string | null;
}

/** @deprecated Use AgentOrgPlanRevision. */
export type AgentOrgPlanApproval = AgentOrgPlanRevision;

export async function getAgentOrgPlanApprovalDetail(input: {
  sessionId: string;
  approvalId: string;
  planRevisionId: string;
}): Promise<AgentOrgPlanApproval> {
  return invokeTauri<AgentOrgPlanApproval>(
    "agent_org_plan_approval_detail",
    input
  );
}

export async function respondAgentOrgPlanApproval(input: {
  sessionId: string;
  approvalId: string;
  planRevisionId: string;
  sourceTaskId: string;
  sourceTurnIntentId: string;
  decision: "approve" | "request_changes";
  feedback?: string | null;
}): Promise<AgentOrgPlanApproval> {
  return invokeTauri<AgentOrgPlanApproval>("agent_org_plan_approval_respond", {
    ...input,
    feedback: input.feedback ?? null,
  });
}
