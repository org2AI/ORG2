import { invokeTauri } from "@src/util/platform/tauri/init";

import type { AgentOrgOwnerRuntime, AgentOrgRunContextMember } from "./members";
import { publishAgentOrgStateChange } from "./stateChanges";
import type { AgentOrgTaskStatus } from "./taskStatus";

export interface AgentOrgTask {
  id: string;
  orgRunId: string;
  subject: string;
  description: string;
  /** True when Run View carries a preview; use task_get for full content. */
  descriptionTruncated?: boolean;
  activeForm?: string | null;
  owner?: string | null;
  ownerMember?: AgentOrgRunContextMember | null;
  ownerRuntime?: AgentOrgOwnerRuntime | null;
  executionHandoff?: AgentOrgTaskExecutionHandoffReceipt | null;
  status: AgentOrgTaskStatus;
  blocks: string[];
  /** True when the polling/list projection carries only a prefix. */
  blocksTruncated?: boolean;
  blockedBy: string[];
  /** True when the polling/list projection carries only a prefix. */
  blockedByTruncated?: boolean;
  /** Backend-authoritative readiness for bounded Current/History pages. */
  dependenciesSatisfied?: boolean;
  metadata?: unknown;
  executionMode: "build" | "plan";
  output?: AgentOrgTaskOutput | null;
  outputSummary?: AgentOrgTaskOutputSummary | null;
  failureReason?: AgentOrgTaskTerminalReason | null;
  cancelReason?: AgentOrgTaskTerminalReason | null;
  createdByParticipantId?: string;
  sourceTurnIntentId?: string;
  originatingMessageId?: string | null;
  replacesTaskId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentOrgTaskOutput {
  summary: string;
  content?: string | null;
  artifactIds: string[];
  producedByMemberId: string;
  producedAt: string;
  /** Set only by the backend when a Planning Task completes for this revision. */
  planRevisionId?: string | null;
}

export interface AgentOrgTaskOutputSummary {
  summary: string;
  artifactIds: string[];
  artifactIdsTruncated: boolean;
  producedByMemberId?: string | null;
  producedAt?: string | null;
  hasContent: boolean;
}

export interface AgentOrgTaskTerminalReason {
  code: string;
  message: string;
  sourceEventId?: string | null;
}

export type AgentOrgTaskExecutionHandoffState =
  | "requested"
  | "yielding"
  | "released"
  | "timeout"
  | "unknown"
  | "failed";

export type AgentOrgTaskExecutionHandoffResolution =
  | "continue_replacement"
  | "keep_stopped"
  | "abandon_episode";

export interface AgentOrgTaskExecutionHandoffReceipt {
  id: string;
  orgRunId: string;
  activationGeneration: number;
  requestId: string;
  requestDigest: string;
  oldTaskId: string;
  oldOwnerMemberId: string;
  oldSessionId?: string | null;
  oldTurnIntentId?: string | null;
  runtimeLeaseId?: string | null;
  dialogTurnGeneration?: string | null;
  replacementTaskId?: string | null;
  state: AgentOrgTaskExecutionHandoffState;
  sloMissed: boolean;
  externalEffectUnknown: boolean;
  localEffectCount: number;
  resolutionRequestId?: string | null;
  resolutionSessionId?: string | null;
  requestedResolution?: AgentOrgTaskExecutionHandoffResolution | null;
  resolutionAttempt: number;
  resolutionRequestedAt?: string | null;
  resolution?: AgentOrgTaskExecutionHandoffResolution | null;
  requestedAt: string;
  releasedAt?: string | null;
  resolvedAt?: string | null;
  updatedAt: string;
}

export interface AgentOrgTaskHandoffRequestResult {
  task: AgentOrgTask;
  replacement?: AgentOrgTask | null;
  executionHandoff?: AgentOrgTaskExecutionHandoffReceipt | null;
  scopeRemoval?: AgentOrgScopeRemovalReceipt | null;
}

export interface AgentOrgScopeRemovalReceipt {
  id: string;
  orgRunId: string;
  workEpisodeId: string;
  targetTaskId: string;
  rootUserEventId: string;
  requestId: string;
  actorSessionId: string;
  status: "recorded" | "revoked";
  createdAt: string;
}

export type AgentOrgTaskPageBucket = "current" | "history";
export type AgentOrgTaskPageDirection = "forward" | "backward";

export interface AgentOrgTaskPage {
  bucket: AgentOrgTaskPageBucket;
  status?: AgentOrgTaskStatus | null;
  tasks: AgentOrgTask[];
  hasMore: boolean;
  nextCursor?: string | null;
  previousCursor?: string | null;
}

export interface AgentOrgTaskAnnotation {
  id: string;
  orgRunId: string;
  taskId: string;
  kind: "progress" | "evidence" | "audit_note";
  body: string;
  actorKind: string;
  actorParticipantId: string;
  sourceTurnIntentId?: string | null;
  createdAt: string;
}

export interface AgentOrgTaskAnnotationPage {
  annotations: AgentOrgTaskAnnotation[];
  hasMore: boolean;
  nextCursor?: string | null;
}

export async function requestAgentOrgTaskHandoff(input: {
  sessionId: string;
  requestId: string;
  taskId: string;
  action: "cancel" | "reassign";
  replacementOwnerMemberId?: string | null;
}): Promise<AgentOrgTaskHandoffRequestResult> {
  const result = await invokeTauri<AgentOrgTaskHandoffRequestResult>(
    "agent_org_task_handoff_request",
    { request: input }
  );
  publishAgentOrgStateChange(input.sessionId);
  return result;
}

export async function resolveAgentOrgTaskHandoff(input: {
  sessionId: string;
  requestId: string;
  receiptId: string;
  resolution: AgentOrgTaskExecutionHandoffResolution;
}): Promise<AgentOrgTaskExecutionHandoffReceipt> {
  const result = await invokeTauri<AgentOrgTaskExecutionHandoffReceipt>(
    "agent_org_task_handoff_resolve",
    { request: input }
  );
  publishAgentOrgStateChange(input.sessionId);
  return result;
}

export async function getAgentOrgTaskPage(input: {
  sessionId: string;
  bucket: AgentOrgTaskPageBucket;
  status?: AgentOrgTaskStatus | null;
  cursor?: string | null;
  direction?: AgentOrgTaskPageDirection;
  limit?: number;
}): Promise<AgentOrgTaskPage> {
  return invokeTauri<AgentOrgTaskPage>("agent_org_session_task_page", {
    sessionId: input.sessionId,
    bucket: input.bucket,
    status: input.status ?? null,
    cursor: input.cursor ?? null,
    direction: input.direction ?? "forward",
    limit: input.limit ?? 50,
  });
}

export async function getAgentOrgTaskDetail(input: {
  sessionId: string;
  taskId: string;
}): Promise<AgentOrgTask> {
  return invokeTauri<AgentOrgTask>("agent_org_session_task_detail", input);
}

export async function getAgentOrgTaskAnnotationPage(input: {
  sessionId: string;
  taskId: string;
  cursor?: string | null;
  limit?: number;
}): Promise<AgentOrgTaskAnnotationPage> {
  return invokeTauri<AgentOrgTaskAnnotationPage>(
    "agent_org_session_task_annotation_page",
    {
      sessionId: input.sessionId,
      taskId: input.taskId,
      cursor: input.cursor ?? null,
      limit: input.limit ?? 50,
    }
  );
}
