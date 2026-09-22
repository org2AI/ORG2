export const AGENT_ORG_TASK_STATUS = {
  PENDING: "pending",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
} as const;

export type AgentOrgTaskStatus =
  (typeof AGENT_ORG_TASK_STATUS)[keyof typeof AGENT_ORG_TASK_STATUS];

export function isAgentOrgTaskTerminalStatus(
  status: AgentOrgTaskStatus
): boolean {
  return (
    status === AGENT_ORG_TASK_STATUS.COMPLETED ||
    status === AGENT_ORG_TASK_STATUS.FAILED ||
    status === AGENT_ORG_TASK_STATUS.CANCELLED
  );
}

export function isAgentOrgTaskOpenStatus(status: AgentOrgTaskStatus): boolean {
  return (
    status === AGENT_ORG_TASK_STATUS.PENDING ||
    status === AGENT_ORG_TASK_STATUS.IN_PROGRESS
  );
}

export function agentOrgTaskStatusSatisfiesDependency(
  status: AgentOrgTaskStatus
): boolean {
  return status === AGENT_ORG_TASK_STATUS.COMPLETED;
}
