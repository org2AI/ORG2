interface WorkspacePortScanVisibilityOptions {
  isCodeMode: boolean;
  isBrowserMode: boolean;
  chatPanelFocused: boolean;
  hasActiveTab: boolean;
  isLaunchpad: boolean;
  isAgentStation: boolean;
}

/** Keep the shared running-server list current only on surfaces that expose it. */
export function shouldEnableWorkspacePortScan({
  isCodeMode,
  isBrowserMode,
  chatPanelFocused,
  hasActiveTab,
  isLaunchpad,
  isAgentStation,
}: WorkspacePortScanVisibilityOptions): boolean {
  return (
    (isCodeMode || isBrowserMode) &&
    !chatPanelFocused &&
    hasActiveTab &&
    !isLaunchpad &&
    !isAgentStation
  );
}
