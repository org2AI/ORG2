import React, { memo } from "react";

import { AGENT_ORG_TASK_STATUS, type AgentOrgTask } from "@src/api/tauri/agent";

import { AgentOrgTaskRow } from "./AgentOrgTaskRow";
import { isTaskBlocked } from "./agentOrgTaskListHelpers";
import { useAgentOrgTaskDetails } from "./useAgentOrgTaskDetails";

interface AgentOrgTaskListProps {
  tasks: AgentOrgTask[];
  listTestId: string;
  rowTestId: string;
  className?: string;
  currentSessionId?: string;
  currentRunId?: string;
  awaitingApprovalTaskIds?: string[];
  canManageTasks?: boolean;
  onTaskAction?: (task: AgentOrgTask, action: "cancel" | "reassign") => void;
}

export const AgentOrgTaskList: React.FC<AgentOrgTaskListProps> = memo(
  ({
    tasks,
    listTestId,
    rowTestId,
    className = "px-1 pb-1",
    currentSessionId,
    currentRunId,
    awaitingApprovalTaskIds = [],
    canManageTasks = false,
    onTaskAction,
  }) => {
    const {
      expandedTaskId,
      details,
      annotationPages,
      loadingTaskId,
      annotationLoadingTaskId,
      detailErrorTaskId,
      toggleDetail,
      loadMoreAnnotations,
    } = useAgentOrgTaskDetails({ tasks, currentSessionId, currentRunId });

    const tasksById = new Map(tasks.map((task) => [task.id, task]));
    const awaitingApprovalTaskIdSet = new Set(awaitingApprovalTaskIds);

    return (
      <div className={`${className} space-y-2`} data-testid={listTestId}>
        {tasks.map((task) => {
          const blocked = isTaskBlocked(task, tasksById);
          const awaitingApproval =
            task.status === AGENT_ORG_TASK_STATUS.IN_PROGRESS &&
            awaitingApprovalTaskIdSet.has(task.id);
          return (
            <AgentOrgTaskRow
              key={task.id}
              task={task}
              blocked={blocked}
              awaitingApproval={awaitingApproval}
              rowTestId={rowTestId}
              currentSessionId={currentSessionId}
              canManageTasks={canManageTasks}
              onTaskAction={onTaskAction}
              expandedTaskId={expandedTaskId}
              onToggleDetail={toggleDetail}
              loadingTaskId={loadingTaskId}
              detailErrorTaskId={detailErrorTaskId}
              details={details}
              annotationPages={annotationPages}
              annotationLoadingTaskId={annotationLoadingTaskId}
              onLoadMoreAnnotations={loadMoreAnnotations}
            />
          );
        })}
      </div>
    );
  }
);

AgentOrgTaskList.displayName = "AgentOrgTaskList";
