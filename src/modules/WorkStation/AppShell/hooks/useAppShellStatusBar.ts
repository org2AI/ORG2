import { useSetAtom } from "jotai";
import { useEffect } from "react";

import { useWorkStationPanels } from "@src/hooks/tabHost/useWorkStationPanels";
import {
  openBranchSpotlight,
  openWorkingDirectorySpotlight,
  openWorktreeSpotlight,
} from "@src/scaffold/GlobalSpotlight/openSpotlight";
import { perAppStatusBarCallbacksAtom } from "@src/store/ui/workStationLayout/statusBarAtoms";

/**
 * Workspace / branch / worktree buttons in the code status bar. They are pure
 * GlobalSpotlight openers with no host-local state, so the AppShell owns them:
 * the status bar renders whenever the shell does, while the code host unmounts
 * on the empty Launchpad (see `hostMountPolicy.ts`). Registering them from the
 * host left the buttons dead there.
 *
 * Module-level so the identity is stable across renders.
 */
const SPOTLIGHT_CALLBACKS = {
  onRepoClick: () => openWorkingDirectorySpotlight("switch"),
  onBranchClick: () => openBranchSpotlight(),
  onWorktreeClick: openWorktreeSpotlight,
} as const;

interface UseAppShellStatusBarOptions {
  primaryPanelCollapsed: boolean;
  showSettingsButton: boolean;
  handleOpenSettings: () => void;
  workStationPanels: ReturnType<typeof useWorkStationPanels>;
}

export function useAppShellStatusBar({
  primaryPanelCollapsed,
  showSettingsButton,
  handleOpenSettings,
  workStationPanels,
}: UseAppShellStatusBarOptions): void {
  const setPerAppStatusBarCallbacks = useSetAtom(perAppStatusBarCallbacksAtom);

  useEffect(() => {
    // Panel callbacks tied to the shared `workStationPrimarySidebarCollapsedAtom`.
    // Browser registers its own status-bar callbacks from useBrowserLayoutState;
    // leave its independently owned slot untouched.
    const sharedPanelCallbacks = {
      onTogglePrimaryPanel: workStationPanels.togglePrimarySidebar,
      primaryPanelCollapsed,
      layoutMode: workStationPanels.layoutMode,
    };
    setPerAppStatusBarCallbacks((prev) => ({
      ...prev,
      code: {
        ...prev.code,
        ...SPOTLIGHT_CALLBACKS,
        onOpenSettings: showSettingsButton ? handleOpenSettings : undefined,
        ...sharedPanelCallbacks,
      },
      project: {
        ...prev.project,
        onOpenSettings: showSettingsButton ? handleOpenSettings : undefined,
        ...sharedPanelCallbacks,
      },
    }));
  }, [
    handleOpenSettings,
    showSettingsButton,
    setPerAppStatusBarCallbacks,
    workStationPanels.togglePrimarySidebar,
    primaryPanelCollapsed,
    workStationPanels.layoutMode,
  ]);
}
