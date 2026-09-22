import React from "react";
import { useTranslation } from "react-i18next";

import type { AgentOrgTaskExecutionHandoffReceipt } from "@src/api/tauri/agent";
import Button from "@src/components/Button";
import { Alert01Icon, HugeiconsIcon } from "@src/icons";

import type { HandoffResolutionDialogState } from "./agentOrgOverviewPanelShared";

interface AgentOrgOverviewHandoffCardProps {
  receipt: AgentOrgTaskExecutionHandoffReceipt;
  canManageTasks: boolean;
  onRequestResolution: (dialog: HandoffResolutionDialogState) => void;
}

const AgentOrgOverviewHandoffCard: React.FC<
  AgentOrgOverviewHandoffCardProps
> = ({ receipt, canManageTasks, onRequestResolution }) => {
  const { t } = useTranslation("sessions");
  const requestedResolution = receipt.requestedResolution ?? null;
  const applyingResolution = requestedResolution !== null;
  const resolutionApplicationFailed =
    applyingResolution && receipt.state === "failed";
  const resolvable =
    !applyingResolution &&
    (receipt.state === "timeout" ||
      receipt.state === "unknown" ||
      receipt.state === "failed");
  return (
    <div
      className="space-y-2 rounded-md border border-warning-6/30 bg-warning-6/5 px-2 py-2 text-[10px] text-text-2"
      data-testid="agent-org-task-handoff-status"
      data-handoff-state={receipt.state}
      data-requested-resolution={requestedResolution ?? undefined}
      data-resolution-attempt={receipt.resolutionAttempt}
    >
      <div className="flex items-center gap-1 font-medium text-warning-6">
        <HugeiconsIcon
          icon={Alert01Icon}
          data-icon="alert"
          size={11}
          strokeWidth={2}
        />
        {resolutionApplicationFailed
          ? t("planner.agentOrgTasks.handoffDecisionFailed")
          : applyingResolution
            ? t("planner.agentOrgTasks.handoffApplyingDecision", {
                decision: t(
                  `planner.agentOrgTasks.${
                    requestedResolution === "continue_replacement"
                      ? "continueReplacement"
                      : requestedResolution === "keep_stopped"
                        ? "keepStopped"
                        : "abandonEpisode"
                  }`
                ),
              })
            : resolvable
              ? t("planner.agentOrgTasks.handoffNeedsDecision")
              : t("planner.agentOrgTasks.handoffStopping")}
      </div>
      <div className="break-all text-text-3">
        {t("planner.agentOrgTasks.handoffEvidence", {
          owner: receipt.oldOwnerMemberId,
          state: receipt.state,
          count: receipt.localEffectCount,
        })}
      </div>
      {resolutionApplicationFailed && canManageTasks && (
        <div className="flex flex-wrap items-center gap-1">
          <Button
            size="mini"
            disabled={
              requestedResolution === "continue_replacement" &&
              receipt.localEffectCount !== 0
            }
            onClick={() =>
              onRequestResolution({
                receipt,
                resolution: requestedResolution,
              })
            }
            data-testid="agent-org-handoff-retry-decision-button"
          >
            {t("planner.agentOrgTasks.retryHandoffDecision")}
          </Button>
          {requestedResolution !== "continue_replacement" && (
            <Button
              size="mini"
              disabled={receipt.localEffectCount !== 0}
              onClick={() =>
                onRequestResolution({
                  receipt,
                  resolution: "continue_replacement",
                })
              }
              data-testid="agent-org-handoff-continue-button"
            >
              {t("planner.agentOrgTasks.continueReplacement")}
            </Button>
          )}
          {requestedResolution !== "keep_stopped" && (
            <Button
              size="mini"
              variant="tertiary"
              onClick={() =>
                onRequestResolution({
                  receipt,
                  resolution: "keep_stopped",
                })
              }
              data-testid="agent-org-handoff-keep-stopped-button"
            >
              {t("planner.agentOrgTasks.keepStopped")}
            </Button>
          )}
          {requestedResolution !== "abandon_episode" && (
            <Button
              size="mini"
              variant="primary"
              tone="danger"
              onClick={() =>
                onRequestResolution({
                  receipt,
                  resolution: "abandon_episode",
                })
              }
              data-testid="agent-org-handoff-abandon-button"
            >
              {t("planner.agentOrgTasks.abandonEpisode")}
            </Button>
          )}
        </div>
      )}
      {resolvable && canManageTasks && (
        <div className="flex flex-wrap items-center gap-1">
          <Button
            size="mini"
            disabled={receipt.localEffectCount !== 0}
            onClick={() =>
              onRequestResolution({
                receipt,
                resolution: "continue_replacement",
              })
            }
            data-testid="agent-org-handoff-continue-button"
          >
            {t("planner.agentOrgTasks.continueReplacement")}
          </Button>
          <Button
            size="mini"
            variant="tertiary"
            onClick={() =>
              onRequestResolution({
                receipt,
                resolution: "keep_stopped",
              })
            }
            data-testid="agent-org-handoff-keep-stopped-button"
          >
            {t("planner.agentOrgTasks.keepStopped")}
          </Button>
          <Button
            size="mini"
            variant="primary"
            tone="danger"
            onClick={() =>
              onRequestResolution({
                receipt,
                resolution: "abandon_episode",
              })
            }
            data-testid="agent-org-handoff-abandon-button"
          >
            {t("planner.agentOrgTasks.abandonEpisode")}
          </Button>
        </div>
      )}
    </div>
  );
};

export default AgentOrgOverviewHandoffCard;
