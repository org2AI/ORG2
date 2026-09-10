import { useCallback } from "react";

import { useAppNavigation } from "@src/hooks/navigation/useAppNavigation";
import { openWorkingDirectorySpotlight } from "@src/scaffold/GlobalSpotlight/openSpotlight";

interface AppShellActions {
  handleSelectRepo: () => void;
  handleOpenSettings: () => void;
}

export function useAppShellActions(): AppShellActions {
  const { goToSettings } = useAppNavigation();

  const handleSelectRepo = useCallback(() => {
    openWorkingDirectorySpotlight("switch");
  }, []);

  const handleOpenSettings = useCallback(() => {
    goToSettings({ section: "appearance", tab: "code-editor" });
  }, [goToSettings]);

  return { handleSelectRepo, handleOpenSettings };
}
