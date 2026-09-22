import React from "react";
import { useTranslation } from "react-i18next";

import {
  AGENT_ORG_TASK_STATUS,
  type AgentOrgTask,
  type AgentOrgTaskAnnotationPage,
  isAgentOrgTaskTerminalStatus,
} from "@src/api/tauri/agent";
import Button from "@src/components/Button";
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  BubbleChatIcon,
  Cancel01Icon,
  HugeiconsIcon,
  LockIcon,
  Refresh04Icon,
} from "@src/icons";

import { AgentOrgTaskDetailPanel } from "./AgentOrgTaskDetailPanel";
import { TaskStatusChip } from "./AgentOrgTaskStatusChip";
import { AgentOrgTaskSubject } from "./AgentOrgTaskSubject";
import {
  TASK_STATUS_CHIP_BASE,
  formatOwner,
  formatSessionStatus,
  getTaskStatusLabelKey,
  ownerRuntimeClass,
} from "./agentOrgTaskListHelpers";

interface AgentOrgTaskRowProps {
  task: AgentOrgTask;
  blocked: boolean;
  awaitingApproval: boolean;
  rowTestId: string;
  currentSessionId: string | undefined;
  canManageTasks: boolean;
  onTaskAction?: (task: AgentOrgTask, action: "cancel" | "reassign") => void;
  expandedTaskId: string | null;
  onToggleDetail: (task: AgentOrgTask) => Promise<void>;
  loadingTaskId: string | null;
  detailErrorTaskId: string | null;
  details: Record<string, AgentOrgTask>;
  annotationPages: Record<string, AgentOrgTaskAnnotationPage>;
  annotationLoadingTaskId: string | null;
  onLoadMoreAnnotations: (taskId: string) => Promise<void>;
}

export const AgentOrgTaskRow: React.FC<AgentOrgTaskRowProps> = ({
  task,
  blocked,
  awaitingApproval,
  rowTestId,
  currentSessionId,
  canManageTasks,
  onTaskAction,
  expandedTaskId,
  onToggleDetail,
  loadingTaskId,
  detailErrorTaskId,
  details,
  annotationPages,
  annotationLoadingTaskId,
  onLoadMoreAnnotations,
}) => {
  const { t } = useTranslation("sessions");
  const done = task.status === AGENT_ORG_TASK_STATUS.COMPLETED;
  const terminal = isAgentOrgTaskTerminalStatus(task.status);
  const statusLabel = t(getTaskStatusLabelKey(task.status, blocked));
  const owner = formatOwner(task);
  const ownerRuntime = task.ownerRuntime;
  const ownerRuntimeLabel = ownerRuntime
    ? formatSessionStatus(ownerRuntime.status)
    : null;
  const ownerIntervention = ownerRuntime?.intervention ?? null;
  const showOwnerRuntimeStatus = Boolean(ownerRuntime) && !done;
  return (
    <div
      className={`rounded-lg border border-border-1 bg-bg-1/90 px-3 py-2 shadow-xs transition-colors hover:bg-bg-2/80 ${blocked ? "opacity-70" : ""}`}
      data-testid={rowTestId}
      data-task-id={task.id}
      data-task-status={task.status}
      data-task-owner={task.owner ?? ""}
      data-task-blocked={blocked ? "true" : "false"}
    >
      <div className="flex min-w-0 items-start gap-3">
        <TaskStatusChip
          status={task.status}
          blocked={blocked}
          label={statusLabel}
        />
        {awaitingApproval ? (
          <span
            className={`${TASK_STATUS_CHIP_BASE} bg-warning-6/10 text-warning-6`}
            data-testid="agent-org-task-awaiting-approval-chip"
          >
            {t("planner.agentOrgTasks.statusAwaitingApproval")}
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <AgentOrgTaskSubject task={task} done={done} />
          {(owner || blocked) && (
            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2 text-[10px] leading-4 text-text-3">
              {owner && (
                <span
                  className="inline-flex max-w-full items-center gap-2 rounded-full bg-bg-2 px-2 py-0.5"
                  data-testid="agent-org-task-owner-meta"
                  data-owner-member-id={task.owner ?? ""}
                  data-owner-session-id={ownerRuntime?.sessionId ?? ""}
                  title={
                    ownerRuntime && ownerRuntimeLabel
                      ? `${t("planner.agentOrgTasks.owner", { owner })} · ${ownerRuntimeLabel}`
                      : t("planner.agentOrgTasks.ownerNoSession", {
                          owner,
                        })
                  }
                >
                  <span className="min-w-0 truncate">
                    {t("planner.agentOrgTasks.owner", { owner })}
                  </span>
                  {showOwnerRuntimeStatus && ownerRuntime && (
                    <span className="flex shrink-0 items-center gap-1.5">
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${ownerRuntimeClass(ownerRuntime.status)}`}
                      />
                      <span>{ownerRuntimeLabel}</span>
                    </span>
                  )}
                  {ownerIntervention && !done && (
                    <span
                      className="flex shrink-0 items-center gap-1 rounded-full bg-warning-6/10 px-1.5 py-0.5 text-warning-6"
                      data-testid="agent-org-task-owner-intervention-badge"
                      title={t("planner.agentOrgIntervention.teammateBusy")}
                    >
                      <HugeiconsIcon
                        icon={BubbleChatIcon}
                        data-icon="message-circle"
                        size={8}
                        strokeWidth={2}
                      />
                      <span>{t("planner.agentOrgIntervention.busyShort")}</span>
                    </span>
                  )}
                </span>
              )}
              {blocked && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warning-6/10 px-2 py-0.5 text-warning-6">
                  <HugeiconsIcon
                    icon={LockIcon}
                    data-icon="lock"
                    size={8}
                    strokeWidth={2}
                  />
                  {task.blockedBy.length}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
      {canManageTasks && !terminal && (
        <div className="mt-2 flex items-center justify-end gap-1">
          {task.status === AGENT_ORG_TASK_STATUS.IN_PROGRESS && (
            <Button
              size="mini"
              variant="tertiary"
              icon={
                <HugeiconsIcon
                  icon={Refresh04Icon}
                  data-icon="refresh"
                  size={10}
                  strokeWidth={2}
                />
              }
              onClick={() => onTaskAction?.(task, "reassign")}
              data-testid="agent-org-task-reassign-button"
            >
              {t("planner.agentOrgTasks.reassign")}
            </Button>
          )}
          <Button
            size="mini"
            variant="tertiary"
            tone="danger"
            icon={
              <HugeiconsIcon
                icon={Cancel01Icon}
                data-icon="cancel"
                size={10}
                strokeWidth={2}
              />
            }
            onClick={() => onTaskAction?.(task, "cancel")}
            data-testid="agent-org-task-cancel-button"
          >
            {t("planner.agentOrgTasks.cancelTask")}
          </Button>
        </div>
      )}
      {terminal && currentSessionId && (
        <Button
          variant="ghost"
          size="inline"
          className="mt-2 gap-1 text-[10px] hover:text-text-1 focus-visible:ring-2 focus-visible:ring-primary-6/30 focus-visible:outline-none"
          aria-expanded={expandedTaskId === task.id}
          onClick={() => void onToggleDetail(task)}
          data-testid="agent-org-task-detail-toggle"
          icon={
            <HugeiconsIcon
              icon={
                expandedTaskId === task.id ? ArrowDown01Icon : ArrowRight01Icon
              }
              data-icon={
                expandedTaskId === task.id ? "chevron-down" : "chevron-right"
              }
              size={11}
              strokeWidth={2}
            />
          }
        >
          {t("planner.agentOrgTasks.details")}
        </Button>
      )}
      {expandedTaskId === task.id && terminal && (
        <AgentOrgTaskDetailPanel
          task={task}
          loadingTaskId={loadingTaskId}
          detailErrorTaskId={detailErrorTaskId}
          details={details}
          annotationPages={annotationPages}
          annotationLoadingTaskId={annotationLoadingTaskId}
          onLoadMoreAnnotations={onLoadMoreAnnotations}
        />
      )}
    </div>
  );
};
