/**
 * Agent Org Tauri IPC bindings and their wire types.
 *
 * The bindings are grouped by domain under `orgTasks/`. This module stays the
 * import path for callers and re-exports the whole public surface.
 */
export type {
  AgentOrgGroupDeliveryInput,
  AgentOrgGroupDeliveryResponse,
  AgentOrgGroupChatMessageResponse,
  AgentOrgGroupRoute,
  AgentOrgGroupConversationKind,
  AgentOrgGroupDisplayState,
  AgentOrgGroupRetryMode,
  AgentOrgGroupOrderKey,
  AgentOrgGroupSourceRef,
  AgentOrgGroupConversationItem,
  AgentOrgGroupActivityKind,
  AgentOrgGroupActivityItem,
  AgentOrgGroupDiagnosticItem,
  AgentOrgGroupProjectionItem,
  AgentOrgGroupProjectionPage,
  AgentOrgGroupRootMessageResponse,
  AgentOrgGroupStopResponse,
  AgentOrgGroupRetryResponse,
} from "./orgTasks/group";
export {
  isAgentOrgGroupConversationItem,
  getAgentOrgGroupProjectionPage,
  sendAgentOrgGroupChatMessage,
  sendAgentOrgGroupRootMessage,
  stopAgentOrgGroupDelivery,
  retryAgentOrgGroupDelivery,
} from "./orgTasks/group";
export type {
  AgentOrgInboxPreviewRow,
  AgentOrgInboxRuntimeRow,
} from "./orgTasks/inbox";
export type {
  AgentOrgMemberIntervention,
  ReturnToWorkOutcome,
  AppliedReturnToWorkOutcome,
  ReturnToWorkResult,
  AgentOrgOwnerRuntime,
  AgentOrgRunContextMember,
  AgentOrgRunMemberView,
} from "./orgTasks/members";
export { returnAgentOrgSessionToWork } from "./orgTasks/members";
export type {
  AgentOrgPlanTaskOutputRef,
  AgentOrgPlanRevisionSummary,
  AgentOrgPlanApprovalSummary,
  AgentOrgPlanRevision,
  AgentOrgPlanApproval,
} from "./orgTasks/plans";
export {
  getAgentOrgPlanApprovalDetail,
  respondAgentOrgPlanApproval,
} from "./orgTasks/plans";
export type {
  ArchiveRunOutcome,
  PauseRunOutcome,
  ResumeRunOutcome,
} from "./orgTasks/runLifecycle";
export {
  retryAgentOrgFinalSummary,
  pauseAgentOrgRun,
  resumeAgentOrgRun,
  archiveAgentOrgRun,
  deleteAgentOrgTeam,
} from "./orgTasks/runLifecycle";
export type {
  AgentOrgRunContext,
  AgentOrgRunStatus,
  AgentOrgRunPhase,
  AgentOrgCoordinatorWorkState,
  AgentOrgRunCompletionOutcome,
  AgentOrgRunCompletionView,
  AgentOrgTaskStateProjection,
  AgentOrgTaskStateWindow,
  AgentOrgRunWorkState,
  AgentOrgRunBlockerKind,
  AgentOrgRunBlockerObject,
  AgentOrgRunBlockerRecoveryState,
  AgentOrgRunBlocker,
  AgentOrgFinalSummaryStatus,
  AgentOrgFinalSummaryReceipt,
  AgentOrgFormalActivity,
  AgentOrgRunView,
  AgentOrgPauseHandoffSummary,
  AgentOrgArchiveTeardownSummary,
  AgentOrgRunTaskOverview,
} from "./orgTasks/runView";
export {
  AGENT_ORG_RUN_STATUS,
  AGENT_ORG_RUN_PHASE,
  getAgentOrgSessionRunView,
} from "./orgTasks/runView";
export { subscribeAgentOrgStateChanges } from "./orgTasks/stateChanges";
export type { AgentOrgTaskStatus } from "./orgTasks/taskStatus";
export {
  AGENT_ORG_TASK_STATUS,
  isAgentOrgTaskTerminalStatus,
  isAgentOrgTaskOpenStatus,
  agentOrgTaskStatusSatisfiesDependency,
} from "./orgTasks/taskStatus";
export type {
  AgentOrgTask,
  AgentOrgTaskOutput,
  AgentOrgTaskOutputSummary,
  AgentOrgTaskTerminalReason,
  AgentOrgTaskExecutionHandoffState,
  AgentOrgTaskExecutionHandoffResolution,
  AgentOrgTaskExecutionHandoffReceipt,
  AgentOrgTaskHandoffRequestResult,
  AgentOrgScopeRemovalReceipt,
  AgentOrgTaskPageBucket,
  AgentOrgTaskPageDirection,
  AgentOrgTaskPage,
  AgentOrgTaskAnnotation,
  AgentOrgTaskAnnotationPage,
} from "./orgTasks/tasks";
export {
  requestAgentOrgTaskHandoff,
  resolveAgentOrgTaskHandoff,
  getAgentOrgTaskPage,
  getAgentOrgTaskDetail,
  getAgentOrgTaskAnnotationPage,
} from "./orgTasks/tasks";
