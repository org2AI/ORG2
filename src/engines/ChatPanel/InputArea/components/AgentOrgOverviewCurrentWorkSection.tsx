import React from "react";
import { useTranslation } from "react-i18next";

import type {
  AgentOrgRunView,
  AgentOrgTask,
  AgentOrgTaskExecutionHandoffReceipt,
} from "@src/api/tauri/agent";

import AgentOrgOverviewHandoffCard from "./AgentOrgOverviewHandoffCard";
import OverviewSectionToggle from "./AgentOrgOverviewSectionToggle";
import { AgentOrgTaskList } from "./AgentOrgTaskList";
import type { HandoffResolutionDialogState } from "./agentOrgOverviewPanelShared";

interface AgentOrgOverviewCurrentWorkSectionProps {
  view: AgentOrgRunView;
  currentSessionId: string;
  expanded: boolean;
  onToggle: () => void;
  blockedCurrentTaskCount: number;
  activeHandoffs: AgentOrgTaskExecutionHandoffReceipt[];
  awaitingApprovalTaskIds: string[];
  canManageTasks: boolean;
  onRequestResolution: (dialog: HandoffResolutionDialogState) => void;
  onTaskAction: (task: AgentOrgTask, action: "cancel" | "reassign") => void;
}

const AgentOrgOverviewCurrentWorkSection: React.FC<
  AgentOrgOverviewCurrentWorkSectionProps
> = ({
  view,
  currentSessionId,
  expanded,
  onToggle,
  blockedCurrentTaskCount,
  activeHandoffs,
  awaitingApprovalTaskIds,
  canManageTasks,
  onRequestResolution,
  onTaskAction,
}) => {
  const { t } = useTranslation("sessions");
  return (
    <div className="space-y-1" data-testid="agent-org-overview-tasks">
      <OverviewSectionToggle
        expanded={expanded}
        label={t("planner.agentOrgTasks.currentWork")}
        count={view.tasks.length}
        blockedCount={blockedCurrentTaskCount}
        blockedLabel={t("planner.agentOrgTasks.statusBlocked")}
        onToggle={onToggle}
        testId="agent-org-current-work-toggle"
      />
      {(expanded ? activeHandoffs : []).map((receipt) => (
        <AgentOrgOverviewHandoffCard
          key={receipt.id}
          receipt={receipt}
          canManageTasks={canManageTasks}
          onRequestResolution={onRequestResolution}
        />
      ))}
      {expanded && view.tasks.length > 0 ? (
        <AgentOrgTaskList
          tasks={view.tasks}
          awaitingApprovalTaskIds={awaitingApprovalTaskIds}
          listTestId="agent-org-overview-task-list"
          rowTestId="agent-org-overview-task-row"
          className="px-0 pb-0"
          currentSessionId={currentSessionId}
          currentRunId={view.context.runId}
          canManageTasks={canManageTasks}
          onTaskAction={onTaskAction}
        />
      ) : expanded ? (
        <div className="px-1 py-2 text-[10px] text-text-3">
          {t("planner.agentOrgTasks.currentEmpty")}
        </div>
      ) : null}
      {expanded && view.taskOverview.truncated && (
        <div
          className="px-1 text-[10px] text-text-3"
          data-testid="agent-org-overview-task-window-note"
        >
          {t("planner.agentOrgOverview.taskWindowTruncated", {
            visible: view.taskOverview.visible,
            total: view.taskOverview.pending + view.taskOverview.inProgress,
          })}
        </div>
      )}
    </div>
  );
};

export default AgentOrgOverviewCurrentWorkSection;
