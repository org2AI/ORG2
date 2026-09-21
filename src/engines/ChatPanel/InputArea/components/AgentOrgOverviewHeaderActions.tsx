import React from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import {
  ArchiveIcon,
  HugeiconsIcon,
  PauseIcon,
  PlayIcon,
  Refresh04Icon,
  WorkHistoryIcon,
} from "@src/icons";

interface AgentOrgOverviewHeaderActionsProps {
  canNavigateToCoordinator: boolean;
  onNavigateToCoordinator: () => void;
  isRunning: boolean;
  isPaused: boolean;
  isTogglingPause: boolean;
  onPauseRun: () => Promise<void>;
  onResumeRun: () => Promise<void>;
  canArchive: boolean;
  isArchiving: boolean;
  onArchiveRun: () => Promise<void>;
  onRefreshClick: () => void;
  refreshSpinClass: string | undefined;
}

const AgentOrgOverviewHeaderActions: React.FC<
  AgentOrgOverviewHeaderActionsProps
> = ({
  canNavigateToCoordinator,
  onNavigateToCoordinator,
  isRunning,
  isPaused,
  isTogglingPause,
  onPauseRun,
  onResumeRun,
  canArchive,
  isArchiving,
  onArchiveRun,
  onRefreshClick,
  refreshSpinClass,
}) => {
  const { t } = useTranslation("sessions");
  return (
    <div className="flex items-center gap-0.5">
      {canNavigateToCoordinator && (
        <Button
          variant="tertiary"
          size="mini"
          iconOnly
          aria-label={t("planner.agentOrgOverview.viewCoordinatorHistory")}
          title={t("planner.agentOrgOverview.viewCoordinatorHistory")}
          onClick={onNavigateToCoordinator}
          data-testid="agent-org-overview-coordinator-history-button"
          icon={
            <HugeiconsIcon
              icon={WorkHistoryIcon}
              data-icon="history"
              size={11}
              strokeWidth={2}
            />
          }
        />
      )}
      {isRunning && (
        <Button
          size="mini"
          iconOnly
          disabled={isTogglingPause}
          aria-label={t("planner.agentOrgOverview.pauseRun")}
          title={t("planner.agentOrgOverview.pauseRun")}
          onClick={() => void onPauseRun()}
          data-testid="agent-org-overview-pause-button"
          icon={
            <HugeiconsIcon
              icon={PauseIcon}
              data-icon="pause"
              size={11}
              strokeWidth={2}
            />
          }
        />
      )}
      {isPaused && (
        <Button
          variant="tertiary"
          size="mini"
          iconOnly
          disabled={isTogglingPause}
          aria-label={t("planner.agentOrgOverview.resumeRun")}
          title={t("planner.agentOrgOverview.resumeRun")}
          onClick={() => void onResumeRun()}
          data-testid="agent-org-overview-resume-button"
          icon={
            <HugeiconsIcon
              icon={PlayIcon}
              data-icon="play"
              size={11}
              strokeWidth={2}
            />
          }
        />
      )}
      {canArchive && (
        <Button
          variant="tertiary"
          size="mini"
          iconOnly
          disabled={isArchiving || isTogglingPause}
          aria-label={t("planner.agentOrgOverview.archiveRun", {
            defaultValue: "Archive Team",
          })}
          title={t("planner.agentOrgOverview.archiveRun", {
            defaultValue: "Archive Team",
          })}
          onClick={() => void onArchiveRun()}
          data-testid="agent-org-overview-archive-button"
          icon={
            <HugeiconsIcon
              icon={ArchiveIcon}
              data-icon="archive"
              size={11}
              strokeWidth={2}
            />
          }
        />
      )}
      <Button
        variant="tertiary"
        size="mini"
        iconOnly
        aria-label={t("common:actions.refresh")}
        title={t("common:actions.refresh")}
        onClick={onRefreshClick}
        data-testid="agent-org-overview-refresh-button"
        icon={
          <HugeiconsIcon
            icon={Refresh04Icon}
            data-icon="refresh-cw"
            size={12}
            strokeWidth={2}
            className={refreshSpinClass}
          />
        }
      />
    </div>
  );
};

export default AgentOrgOverviewHeaderActions;
