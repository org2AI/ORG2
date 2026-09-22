import { invokeTauri } from "@src/util/platform/tauri/init";

import type { AgentOrgInboxPreviewRow } from "./inbox";
import type {
  AgentOrgRunContextMember,
  AgentOrgRunMemberView,
} from "./members";
import type { AgentOrgPlanRevisionSummary } from "./plans";
import type { AgentOrgTaskStatus } from "./taskStatus";
import type {
  AgentOrgTask,
  AgentOrgTaskExecutionHandoffReceipt,
} from "./tasks";

export interface AgentOrgRunContext {
  runId: string;
  orgId: string;
  orgName: string;
  orgRole: string;
  coordinatorAgentId: string;
  coordinatorName: string;
  coordinatorRole: string;
  members: AgentOrgRunContextMember[];
  planApprovalPolicy: "coordinator" | "user" | "automatic";
  /** Session ID of the coordinator (root) session. Used to navigate directly
   *  to the coordinator's chat history when the run is paused or the user
   *  is viewing a different member. `null` only before the first coordinator
   *  session has been materialized. */
  rootSessionId?: string | null;
}

export const AGENT_ORG_RUN_STATUS = {
  STARTING: "starting",
  RUNNING: "running",
  PAUSED: "paused",
  IDLE: "idle",
  FAILED: "failed",
  ARCHIVED: "archived",
} as const;

export type AgentOrgRunStatus =
  (typeof AGENT_ORG_RUN_STATUS)[keyof typeof AGENT_ORG_RUN_STATUS];

export const AGENT_ORG_RUN_PHASE = {
  STARTING: "starting",
  COORDINATING: "coordinating",
  DISPATCHING: "dispatching",
  MEMBERS_WORKING: "members_working",
  WAITING: "waiting",
  AWAITING_PLAN_APPROVAL: "awaiting_plan_approval",
  FINALIZING: "finalizing",
  DRAINING: "draining",
  PAUSED: "paused",
  IDLE: "idle",
  FAILED: "failed",
  ARCHIVED: "archived",
} as const;

export type AgentOrgRunPhase =
  (typeof AGENT_ORG_RUN_PHASE)[keyof typeof AGENT_ORG_RUN_PHASE];

export type AgentOrgCoordinatorWorkState =
  | "active"
  | "waiting_for_org_event"
  | "inactive";

export type AgentOrgRunCompletionOutcome = "delivered" | "cancelled" | "failed";

export interface AgentOrgRunCompletionView {
  state: "none" | "needs_attention" | "certified";
  outcome?: AgentOrgRunCompletionOutcome | null;
  certificateId?: string | null;
  workRevision?: number | null;
}

export interface AgentOrgTaskStateProjection {
  taskId: string;
  status: AgentOrgTaskStatus;
  ownerMemberId?: string | null;
  activationGeneration: number;
  replacesTaskId?: string | null;
  replacementTaskId?: string | null;
  updatedAt: string;
}

export interface AgentOrgTaskStateWindow {
  tasks: AgentOrgTaskStateProjection[];
  truncated: boolean;
}

export interface AgentOrgRunWorkState {
  activeMembers: number;
  inFlightTurns: number;
  openTasks: number;
  blockingInbox: number;
}

export type AgentOrgRunBlockerKind =
  | "activeMembers"
  | "inFlightTurns"
  | "openTasks"
  | "blockingInbox"
  | "corruptTaskData"
  | "unknownTurnIntents"
  | "pendingFormalMaterializations"
  | "activeRecoveryReservations"
  | "pendingPlanApprovals"
  | "unresolvedTaskHandoffs"
  | "staleCompletionCertificate"
  | "taskClosureIncomplete"
  | "invalidScopeRemoval"
  | "invalidReplacementChain"
  | "completionValidation"
  | (string & { readonly __futureAgentOrgBlockerKind?: never });

export interface AgentOrgRunBlockerObject {
  objectKind: string;
  id: string;
  displayName: string;
}

export type AgentOrgRunBlockerRecoveryState =
  | "waiting_for_runtime"
  | "system_repairing"
  | "coordinator_repair_available"
  | "system_attention_required"
  | "user_action_required"
  | (string & { readonly __futureAgentOrgRecoveryState?: never });

export interface AgentOrgRunBlocker {
  kind: AgentOrgRunBlockerKind;
  count: number;
  objects: AgentOrgRunBlockerObject[];
  hasMore: boolean;
  display: string;
  reasonCode: string;
  source: string;
  recoveryState: AgentOrgRunBlockerRecoveryState;
  requiresUserAction: boolean;
  userAction?:
    | "wait_for_members"
    | "wait_for_turns"
    | "wait_for_tasks"
    | "wait_for_inbox"
    | "review_tasks"
    | "review_inbox"
    | "review_plan"
    | "review_handoff"
    | null;
}

export type AgentOrgFinalSummaryStatus =
  | "pending"
  | "running"
  | "persisting"
  | "persisted"
  | "failed";

export interface AgentOrgFinalSummaryReceipt {
  receiptId: string;
  orgRunId: string;
  activationGeneration: number;
  certificateId: string;
  evidenceDigest: string;
  attempt: number;
  status: AgentOrgFinalSummaryStatus;
  coordinatorSessionId: string;
  turnIntentId?: string | null;
  startedAt?: string | null;
  terminalAt?: string | null;
  eventId?: string | null;
  typedError?: string | null;
  canRetry: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgentOrgFormalActivity {
  pendingCount: number;
  materializedCount: number;
  pendingReceiptIds: string[];
  coordinatorObserving: boolean;
}

export interface AgentOrgRunView {
  context: AgentOrgRunContext;
  runStatus: AgentOrgRunStatus;
  runPhase: AgentOrgRunPhase;
  coordinatorWorkState: AgentOrgCoordinatorWorkState;
  completion: AgentOrgRunCompletionView;
  finalSummary?: AgentOrgFinalSummaryReceipt | null;
  formalActivity: AgentOrgFormalActivity;
  pauseHandoff?: AgentOrgPauseHandoffSummary | null;
  archiveTeardown?: AgentOrgArchiveTeardownSummary | null;
  currentMemberId?: string | null;
  members: AgentOrgRunMemberView[];
  tasks: AgentOrgTask[];
  executionHandoffs: AgentOrgTaskExecutionHandoffReceipt[];
  taskOverview: AgentOrgRunTaskOverview;
  taskStateWindow: AgentOrgTaskStateWindow;
  workState: AgentOrgRunWorkState;
  blockers: AgentOrgRunBlocker[];
  inbox: AgentOrgInboxPreviewRow[];
  /** All unread durable Inbox history, including non-actionable lifecycle records. */
  unreadInboxCount: number;
  /** Unread Inbox work that can still affect Team runtime convergence. */
  blockingUnreadInboxCount: number;
  planRevisions: AgentOrgPlanRevisionSummary[];
}

export interface AgentOrgPauseHandoffSummary {
  episodeId: string;
  pauseGeneration: number;
  totalCount: number;
  drainingCount: number;
  timedOutCount: number;
}

export interface AgentOrgArchiveTeardownSummary {
  receiptId: string;
  status: "pending" | "quiesced" | "retained_runtime";
  attemptCount: number;
  retainedRuntimeCount: number;
  deadlineAt: string;
}

export interface AgentOrgRunTaskOverview {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  failed: number;
  cancelled: number;
  corrupt: number;
  visible: number;
  truncated: boolean;
}

export async function getAgentOrgSessionRunView(
  sessionId: string
): Promise<AgentOrgRunView | null> {
  return invokeTauri<AgentOrgRunView | null>("agent_org_session_run_view", {
    sessionId,
  });
}
