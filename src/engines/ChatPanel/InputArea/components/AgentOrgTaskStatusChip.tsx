import React from "react";

import {
  AGENT_ORG_TASK_STATUS,
  type AgentOrgTaskStatus,
} from "@src/api/tauri/agent";

import { TASK_STATUS_CHIP_BASE } from "./agentOrgTaskListHelpers";

export function TaskStatusChip({
  status,
  blocked,
  label,
}: {
  status: AgentOrgTaskStatus;
  blocked: boolean;
  label: string;
}) {
  if (
    blocked &&
    (status === AGENT_ORG_TASK_STATUS.PENDING ||
      status === AGENT_ORG_TASK_STATUS.IN_PROGRESS)
  ) {
    return (
      <span
        className={`${TASK_STATUS_CHIP_BASE} bg-warning-6/10 text-warning-6`}
        data-testid="agent-org-task-status-chip"
      >
        {label}
      </span>
    );
  }

  if (status === AGENT_ORG_TASK_STATUS.COMPLETED) {
    return (
      <span
        className={`${TASK_STATUS_CHIP_BASE} bg-success-6/10 text-success-6`}
        data-testid="agent-org-task-status-chip"
      >
        {label}
      </span>
    );
  }

  if (status === AGENT_ORG_TASK_STATUS.IN_PROGRESS) {
    return (
      <span
        className={`${TASK_STATUS_CHIP_BASE} bg-primary-6/10 text-primary-6`}
        data-testid="agent-org-task-status-chip"
      >
        {label}
      </span>
    );
  }

  if (status === AGENT_ORG_TASK_STATUS.FAILED) {
    return (
      <span
        className={`${TASK_STATUS_CHIP_BASE} bg-error-6/10 text-error-6`}
        data-testid="agent-org-task-status-chip"
      >
        {label}
      </span>
    );
  }

  if (status === AGENT_ORG_TASK_STATUS.CANCELLED) {
    return (
      <span
        className={`${TASK_STATUS_CHIP_BASE} bg-text-3/10 text-text-3`}
        data-testid="agent-org-task-status-chip"
      >
        {label}
      </span>
    );
  }

  return (
    <span
      className={`${TASK_STATUS_CHIP_BASE} bg-fill-3 text-text-3`}
      data-testid="agent-org-task-status-chip"
    >
      {label}
    </span>
  );
}
