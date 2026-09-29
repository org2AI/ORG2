/**
 * WorkStationPage - Main page for Workstation
 *
 * Renders AppShell which handles:
 * - Station chrome and panel controls
 * - Repository path validation
 * - Tab-driven Code Editor, Browser, and Project Manager surfaces
 *
 * ChatPanel is rendered by AppLayout.
 */
import React from "react";

import AppShell from "./AppShell";

interface WorkStationPageProps {
  /** Actual visibility, independent of whether the primary chat fills its area. */
  workstationVisible?: boolean;
  /** Legacy docked-window visibility fallback. */
  chatPanelFocused?: boolean;
}

const WorkStationPage: React.FC<WorkStationPageProps> = ({
  chatPanelFocused = false,
  workstationVisible = !chatPanelFocused,
}) => {
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      <AppShell workstationVisible={workstationVisible} />
    </div>
  );
};

export default WorkStationPage;
