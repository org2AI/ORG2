import React from "react";
import { useTranslation } from "react-i18next";

import type {
  AgentOrgTask,
  AgentOrgTaskAnnotationPage,
} from "@src/api/tauri/agent";
import Button from "@src/components/Button";

interface AgentOrgTaskDetailPanelProps {
  task: AgentOrgTask;
  loadingTaskId: string | null;
  detailErrorTaskId: string | null;
  details: Record<string, AgentOrgTask>;
  annotationPages: Record<string, AgentOrgTaskAnnotationPage>;
  annotationLoadingTaskId: string | null;
  onLoadMoreAnnotations: (taskId: string) => Promise<void>;
}

export const AgentOrgTaskDetailPanel: React.FC<
  AgentOrgTaskDetailPanelProps
> = ({
  task,
  loadingTaskId,
  detailErrorTaskId,
  details,
  annotationPages,
  annotationLoadingTaskId,
  onLoadMoreAnnotations,
}) => {
  const { t } = useTranslation("sessions");
  return (
    <div
      className="mt-2 space-y-2 rounded-md bg-bg-2 p-2 text-[11px] text-text-2"
      data-testid="agent-org-task-detail"
      role="region"
      aria-label={`${task.subject} · ${t("planner.agentOrgTasks.details")}`}
    >
      {loadingTaskId === task.id && (
        <div role="status">{t("planner.agentOrgTasks.loadingDetails")}</div>
      )}
      {detailErrorTaskId === task.id && (
        <div className="text-error-6" role="alert">
          {t("planner.agentOrgTasks.detailLoadFailed")}
        </div>
      )}
      {(details[task.id]?.output ?? task.outputSummary) && (
        <div className="break-words whitespace-pre-wrap">
          <div className="font-medium text-text-1">
            {t("planner.agentOrgTasks.output")}
          </div>
          {details[task.id]?.output?.summary ?? task.outputSummary?.summary}
          {details[task.id]?.output?.content && (
            <div className="mt-1 max-h-40 overflow-y-auto break-words whitespace-pre-wrap">
              {details[task.id].output?.content}
            </div>
          )}
        </div>
      )}
      {(details[task.id]?.failureReason ?? task.failureReason) && (
        <div className="text-error-6 break-words whitespace-pre-wrap">
          {(details[task.id]?.failureReason ?? task.failureReason)?.message}
        </div>
      )}
      {(details[task.id]?.cancelReason ?? task.cancelReason) && (
        <div className="break-words whitespace-pre-wrap">
          {(details[task.id]?.cancelReason ?? task.cancelReason)?.message}
        </div>
      )}
      {(annotationPages[task.id]?.annotations.length ?? 0) > 0 && (
        <div className="space-y-1">
          <div className="font-medium text-text-1">
            {t("planner.agentOrgTasks.annotations")}
          </div>
          {annotationPages[task.id].annotations.map((annotation) => (
            <div key={annotation.id} className="break-words">
              <span className="mr-1 text-text-3">
                {annotation.kind.replace("_", " ")}
              </span>
              {annotation.body}
            </div>
          ))}
          {annotationPages[task.id].hasMore && (
            <Button
              variant="ghost"
              size="inline"
              className="focus-visible:ring-2 focus-visible:ring-primary-6/30 focus-visible:outline-none disabled:opacity-40"
              disabled={annotationLoadingTaskId === task.id}
              onClick={() => void onLoadMoreAnnotations(task.id)}
              data-testid="agent-org-task-annotations-load-more"
            >
              {t("planner.agentOrgTasks.loadMoreAnnotations")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
};
