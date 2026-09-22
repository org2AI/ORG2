import { useTranslation } from "react-i18next";

import type { AgentOrgRunView } from "@src/api/tauri/agent";

export function useAgentOrgOverviewPresentation(view: AgentOrgRunView | null) {
  const { t } = useTranslation("sessions");
  const isRunning = view?.runStatus === "running";
  const isPaused = view?.runStatus === "paused";
  const isArchived = view?.runStatus === "archived";
  const canArchive =
    view?.runStatus === "running" ||
    view?.runStatus === "paused" ||
    view?.runStatus === "idle" ||
    view?.runStatus === "failed";
  const translatedRunPhase = view
    ? t(`planner.agentOrgOverview.phase.${view.runPhase}`, {
        defaultValue: view.runPhase.split("_").join(" "),
      })
    : null;
  const translatedCompletionOutcome =
    view?.completion?.state === "certified" && view.completion.outcome
      ? t(`planner.agentOrgOverview.outcome.${view.completion.outcome}`, {
          defaultValue: view.completion.outcome,
        })
      : null;
  const runPhaseLabel = view
    ? view.runStatus === "idle" && translatedCompletionOutcome
      ? t("planner.agentOrgOverview.idleWithLatestOutcome", {
          phase: translatedRunPhase,
          outcome: translatedCompletionOutcome,
        })
      : view.completion?.state === "certified"
        ? translatedCompletionOutcome
        : view.completion?.state === "needs_attention"
          ? t("planner.agentOrgOverview.needsAttention")
          : translatedRunPhase
    : null;
  const completionBadgeClass =
    view?.completion?.state === "certified"
      ? view.completion.outcome === "delivered"
        ? "bg-success-6/10 text-success-6"
        : view.completion.outcome === "failed"
          ? "bg-error-6/10 text-error-6"
          : "bg-warning-6/10 text-warning-6"
      : view?.completion?.state === "needs_attention"
        ? "bg-warning-6/10 text-warning-6"
        : "bg-bg-1 text-text-2";
  const coordinatorWorkStateLabel = view
    ? t(
        `planner.agentOrgOverview.coordinatorWorkState.${view.coordinatorWorkState}`,
        {
          defaultValue: view.coordinatorWorkState.split("_").join(" "),
        }
      )
    : null;

  return {
    isRunning,
    isPaused,
    isArchived,
    canArchive,
    runPhaseLabel,
    completionBadgeClass,
    coordinatorWorkStateLabel,
  };
}
