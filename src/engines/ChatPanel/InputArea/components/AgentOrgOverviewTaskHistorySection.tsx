import React from "react";
import { useTranslation } from "react-i18next";

import {
  AGENT_ORG_TASK_STATUS,
  type AgentOrgRunView,
  type AgentOrgTaskPage,
  type AgentOrgTaskStatus,
} from "@src/api/tauri/agent";
import Button from "@src/components/Button";

import OverviewSectionToggle from "./AgentOrgOverviewSectionToggle";
import { AgentOrgTaskList } from "./AgentOrgTaskList";
import { reportUnexpectedHistoryLoadError } from "./agentOrgOverviewPanelShared";

interface AgentOrgOverviewTaskHistorySectionProps {
  view: AgentOrgRunView;
  currentSessionId: string;
  historyExpanded: boolean;
  historyStatus: AgentOrgTaskStatus;
  historyPage: AgentOrgTaskPage | null;
  historyLoading: boolean;
  historyError: boolean;
  onHistoryToggle: () => void;
  onHistoryStatus: (status: AgentOrgTaskStatus) => void;
  loadHistoryPage: (
    status: AgentOrgTaskStatus,
    cursor?: string | null,
    direction?: "forward" | "backward"
  ) => Promise<void>;
}

const AgentOrgOverviewTaskHistorySection: React.FC<
  AgentOrgOverviewTaskHistorySectionProps
> = ({
  view,
  currentSessionId,
  historyExpanded,
  historyStatus,
  historyPage,
  historyLoading,
  historyError,
  onHistoryToggle,
  onHistoryStatus,
  loadHistoryPage,
}) => {
  const { t } = useTranslation("sessions");
  return (
    <div className="space-y-2" data-testid="agent-org-task-history">
      <OverviewSectionToggle
        expanded={historyExpanded}
        label={t("planner.agentOrgTasks.history")}
        count={
          view.taskOverview.completed +
          view.taskOverview.failed +
          view.taskOverview.cancelled
        }
        onToggle={onHistoryToggle}
        testId="agent-org-task-history-toggle"
      />

      {historyExpanded && (
        <div className="space-y-2">
          <div
            className="flex flex-wrap gap-1 px-1"
            role="group"
            aria-label={t("planner.agentOrgTasks.historyFilter")}
          >
            {(
              [
                AGENT_ORG_TASK_STATUS.COMPLETED,
                AGENT_ORG_TASK_STATUS.FAILED,
                AGENT_ORG_TASK_STATUS.CANCELLED,
              ] as const
            ).map((status) => (
              <Button
                layout="custom"
                key={status}
                className={`rounded-full px-2 py-0.5 text-[10px] focus-visible:ring-2 focus-visible:ring-primary-6/30 focus-visible:outline-none ${historyStatus === status ? "bg-primary-6/10 text-primary-6" : "bg-bg-1 text-text-3"}`}
                aria-pressed={historyStatus === status}
                onClick={() => onHistoryStatus(status)}
                data-testid={`agent-org-task-history-filter-${status}`}
              >
                {t(
                  status === AGENT_ORG_TASK_STATUS.COMPLETED
                    ? "planner.agentOrgTasks.statusCompleted"
                    : status === AGENT_ORG_TASK_STATUS.FAILED
                      ? "planner.agentOrgTasks.statusFailed"
                      : "planner.agentOrgTasks.statusCancelled"
                )}
              </Button>
            ))}
          </div>
          {historyLoading && (
            <div className="px-1 text-[10px] text-text-3" role="status">
              {t("planner.agentOrgTasks.loadingHistory")}
            </div>
          )}
          {historyError && (
            <div className="text-error-6 px-1 text-[10px]" role="alert">
              {t("planner.agentOrgTasks.historyLoadFailed")}
            </div>
          )}
          {!historyLoading && historyPage?.tasks.length === 0 && (
            <div className="px-1 py-2 text-[10px] text-text-3">
              {t("planner.agentOrgTasks.historyEmpty")}
            </div>
          )}
          {historyPage && historyPage.tasks.length > 0 && (
            <AgentOrgTaskList
              tasks={historyPage.tasks}
              listTestId="agent-org-task-history-list"
              rowTestId="agent-org-task-history-row"
              className="px-0 pb-0"
              currentSessionId={currentSessionId}
              currentRunId={view.context.runId}
            />
          )}
          {historyPage &&
            (historyPage.previousCursor || historyPage.nextCursor) && (
              <div className="flex items-center justify-end gap-1 px-1">
                <Button
                  variant="tertiary"
                  size="mini"
                  className="text-[10px] focus-visible:ring-2 focus-visible:ring-primary-6/30 focus-visible:outline-none disabled:opacity-40"
                  data-testid="agent-org-task-history-previous-page"
                  disabled={!historyPage.previousCursor || historyLoading}
                  onClick={() => {
                    loadHistoryPage(
                      historyStatus,
                      historyPage.previousCursor,
                      "backward"
                    ).catch(reportUnexpectedHistoryLoadError);
                  }}
                >
                  {t("planner.agentOrgTasks.previousPage")}
                </Button>
                <Button
                  variant="tertiary"
                  size="mini"
                  className="text-[10px] focus-visible:ring-2 focus-visible:ring-primary-6/30 focus-visible:outline-none disabled:opacity-40"
                  data-testid="agent-org-task-history-next-page"
                  disabled={!historyPage.nextCursor || historyLoading}
                  onClick={() => {
                    loadHistoryPage(
                      historyStatus,
                      historyPage.nextCursor,
                      "forward"
                    ).catch(reportUnexpectedHistoryLoadError);
                  }}
                >
                  {t("planner.agentOrgTasks.nextPage")}
                </Button>
              </div>
            )}
        </div>
      )}
    </div>
  );
};

export default AgentOrgOverviewTaskHistorySection;
