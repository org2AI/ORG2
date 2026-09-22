import { useCallback, useState } from "react";
import { flushSync } from "react-dom";

import type { AppearanceMode } from "@src/config/appearance/globalThemes";
import { WIKI_OPEN_EVENT } from "@src/features/Wiki/wikiEvents";
import type { UseAppNavigationReturn } from "@src/hooks/navigation/useAppNavigation";

interface UseSidebarSettingsMenuActionsOptions {
  closeAll: () => void;
  goToSettings: UseAppNavigationReturn["goToSettings"];
  handleAppearanceModeChange: (mode: AppearanceMode) => Promise<void>;
}

/**
 * Account dialog visibility, navigation actions that dismiss the menu, and
 * in-place appearance updates that leave the menu tree available.
 */
export function useSidebarSettingsMenuActions({
  closeAll,
  goToSettings,
  handleAppearanceModeChange,
}: UseSidebarSettingsMenuActionsOptions) {
  const [showSignInModal, setShowSignInModal] = useState(false);
  const [showSignOutConfirmation, setShowSignOutConfirmation] = useState(false);

  const handleOpenWiki = useCallback(() => {
    flushSync(closeAll);
    window.dispatchEvent(new CustomEvent(WIKI_OPEN_EVENT));
  }, [closeAll]);

  const handleOpenSettings = useCallback(() => {
    closeAll();
    goToSettings();
  }, [closeAll, goToSettings]);

  const handleModifyAppearance = useCallback(() => {
    closeAll();
    goToSettings({ section: "appearance" });
  }, [closeAll, goToSettings]);

  const handleSignIn = useCallback(() => {
    closeAll();
    setShowSignInModal(true);
  }, [closeAll]);

  const handleSignOut = useCallback(() => {
    closeAll();
    setShowSignOutConfirmation(true);
  }, [closeAll]);

  const handleSelectAppearanceMode = useCallback(
    async (mode: AppearanceMode) => {
      await handleAppearanceModeChange(mode);
    },
    [handleAppearanceModeChange]
  );

  return {
    handleOpenWiki,
    showSignInModal,
    setShowSignInModal,
    showSignOutConfirmation,
    setShowSignOutConfirmation,
    handleOpenSettings,
    handleModifyAppearance,
    handleSignIn,
    handleSignOut,
    handleSelectAppearanceMode,
  };
}
