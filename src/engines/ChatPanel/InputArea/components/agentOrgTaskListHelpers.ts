import {
  AGENT_ORG_TASK_STATUS,
  type AgentOrgTask,
  type AgentOrgTaskStatus,
  agentOrgTaskStatusSatisfiesDependency,
} from "@src/api/tauri/agent";

export const TASK_STATUS_CHIP_BASE =
  "inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium leading-4";

const AGENT_SESSION_STATUS = {
  RUNNING: "running",
  WAITING_FOR_USER: "waiting_for_user",
  FAILED: "failed",
  CANCELLED: "cancelled",
  ABANDONED: "abandoned",
  TIMEOUT: "timeout",
  COMPLETED: "completed",
} as const;

const FAILURE_SESSION_STATUSES = new Set<string>([
  AGENT_SESSION_STATUS.FAILED,
  AGENT_SESSION_STATUS.CANCELLED,
  AGENT_SESSION_STATUS.ABANDONED,
  AGENT_SESSION_STATUS.TIMEOUT,
]);

export function getTaskStatusLabelKey(
  status: AgentOrgTaskStatus,
  blocked: boolean
): string {
  if (
    blocked &&
    (status === AGENT_ORG_TASK_STATUS.PENDING ||
      status === AGENT_ORG_TASK_STATUS.IN_PROGRESS)
  ) {
    return "planner.agentOrgTasks.statusBlocked";
  }
  if (status === AGENT_ORG_TASK_STATUS.COMPLETED) {
    return "planner.agentOrgTasks.statusCompleted";
  }
  if (status === AGENT_ORG_TASK_STATUS.IN_PROGRESS) {
    return "planner.agentOrgTasks.statusInProgress";
  }
  if (status === AGENT_ORG_TASK_STATUS.FAILED) {
    return "planner.agentOrgTasks.statusFailed";
  }
  if (status === AGENT_ORG_TASK_STATUS.CANCELLED) {
    return "planner.agentOrgTasks.statusCancelled";
  }
  return "planner.agentOrgTasks.statusPending";
}

export function formatOwner(task: AgentOrgTask): string | null {
  if (task.ownerMember) {
    return `${task.ownerMember.name} · ${task.ownerMember.role}`;
  }
  if (!task.owner) return null;
  return task.owner.replace(/^builtin:/, "");
}

export function formatSessionStatus(status: string): string {
  return status.replace(/_/g, " ");
}

export function ownerRuntimeClass(status: string): string {
  if (status === AGENT_SESSION_STATUS.RUNNING) return "bg-primary-6";
  if (status === AGENT_SESSION_STATUS.WAITING_FOR_USER) {
    return "bg-warning-6";
  }
  if (FAILURE_SESSION_STATUSES.has(status)) return "bg-error-6";
  if (status === AGENT_SESSION_STATUS.COMPLETED) return "bg-success-6";
  return "bg-text-3/50";
}

export function isTaskBlocked(
  task: AgentOrgTask,
  tasksById: Map<string, AgentOrgTask>
) {
  if (task.dependenciesSatisfied !== undefined) {
    return !task.dependenciesSatisfied;
  }
  return task.blockedBy.some((taskId) => {
    const blocker = tasksById.get(taskId);
    return (
      blocker === undefined ||
      !agentOrgTaskStatusSatisfiesDependency(blocker.status)
    );
  });
}

export function retainVisibleRecords<T>(
  records: Record<string, T>,
  visibleTaskIds: Set<string>
): Record<string, T> {
  const entries = Object.entries(records).filter(([taskId]) =>
    visibleTaskIds.has(taskId)
  );
  return entries.length === Object.keys(records).length
    ? records
    : Object.fromEntries(entries);
}
