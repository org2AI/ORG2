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
  /** Whether the chat panel is taking over the WorkStation surface */
  chatPanelFocused?: boolean;
}

const WorkStationPage: React.FC<WorkStationPageProps> = ({
  chatPanelFocused = false,
}) => {
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      <AppShell chatPanelFocused={chatPanelFocused} />
    </div>
  );
};

export default WorkStationPage;
