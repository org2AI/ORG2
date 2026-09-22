/**
 * SimulatorSingleView Component
 *
 * Pure content frame for the simulator's single-view mode. Mirrors My Station
 * exactly: the frame owns no chrome at all — every app renders its own tab
 * bar (`ReplayTabBar` or a regular `TabBar`) with a leading slot containing
 * the app-switcher chip + primary-sidebar toggle. The tab bar is the single
 * top chrome row; the sidebar starts below it and never owns its own header.
 *
 * Frame-level responsibilities are limited to:
 * - background
 * - the floating replay controls
 * - empty-state placeholder
 */
import React, { useContext } from "react";
import { useTranslation } from "react-i18next";

import { useSessionId } from "@src/engines/SessionCore/hooks/session";
import { createAgentStationQuickActions } from "@src/engines/Simulator/emptyStateActions";
import { AppType } from "@src/engines/Simulator/types/appTypes";
import { NoTabsPlaceholder } from "@src/modules/WorkStation/shared";

import { ReplayControlHostContext } from "../../context/ReplayControlHostContext";
import FloatingReplayContainer from "../FloatingReplayContainer";

interface SimulatorSingleViewProps {
  mainContentAppType: AppType | null;
  displayContent: React.ReactNode;
}

export const SimulatorSingleView: React.FC<SimulatorSingleViewProps> = ({
  mainContentAppType,
  displayContent,
}) => {
  const { t: tCommon } = useTranslation("common");
  const { sessionId } = useSessionId();
  const replayControlOwnedByHost = useContext(ReplayControlHostContext);
  const hasSession = Boolean(sessionId);

  const showSessionPlaceholder = !hasSession && !displayContent;
  const showEmptyTabsPlaceholder = hasSession && !displayContent;

  const showFloatingReplayControls =
    !replayControlOwnedByHost &&
    hasSession &&
    mainContentAppType &&
    mainContentAppType !== AppType.DIFF;

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-bg-2">
      <div className="relative min-h-0 flex-1 overflow-auto text-text-1">
        {showSessionPlaceholder ? (
          <NoTabsPlaceholder
            icon="simulator"
            actions={createAgentStationQuickActions({ t: tCommon })}
          />
        ) : showEmptyTabsPlaceholder ? (
          <NoTabsPlaceholder icon="simulator" />
        ) : (
          displayContent
        )}
      </div>

      {showFloatingReplayControls && <FloatingReplayContainer />}
    </div>
  );
};
