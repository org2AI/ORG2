import { useAtomValue } from "jotai";
import React from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import {
  DROPDOWN_CLASSES,
  DROPDOWN_WIDTHS,
} from "@src/components/Dropdown/tokens";
import { useShortcutKeys } from "@src/config/keyboard/useShortcutBindings";
import { SignInModal } from "@src/features/Org2Cloud/SignInModal";
import { SignOutConfirmationModal } from "@src/features/Org2Cloud/SignOutConfirmationModal";
import { org2CloudAuthAtom } from "@src/features/Org2Cloud/org2CloudAuthAtom";
import { useAppNavigation } from "@src/hooks/navigation";
import { useAppearanceState } from "@src/modules/MainApp/Settings/sections/useAppearanceState";
import { devModeEnabledAtom } from "@src/store/platform/devModeAtom";

import { SidebarRamMonitorPanel } from "../connectors/SidebarRamMonitorButton/index";
import {
  SidebarSettingsMenuLeadingItems,
  SidebarSettingsMenuSubmenuTriggers,
  SidebarSettingsMenuTrailingItems,
} from "./SidebarSettingsMenuItems";
import { SidebarSettingsMenuSubmenus } from "./SidebarSettingsMenuSubmenus";
import { SidebarSettingsMenuTriggerSlot } from "./SidebarSettingsMenuTriggerSlot";
import type { SidebarSettingsMenuButtonProps } from "./sidebarSettingsMenuTypes";
import { useSidebarSettingsMenuActions } from "./useSidebarSettingsMenuActions";
import {
  useSidebarSettingsMenuPopovers,
  useSidebarUtilityPanelDismiss,
} from "./useSidebarSettingsMenuPopovers";

const SidebarSettingsMenuButton: React.FC<SidebarSettingsMenuButtonProps> = ({
  renderTrigger,
  onSignIn,
}) => {
  const { t } = useTranslation("navigation");
  const { t: tSettings } = useTranslation("settings");
  const { goToSettings } = useAppNavigation();
  const signedIn = useAtomValue(org2CloudAuthAtom) !== null;
  const devModeEnabled = useAtomValue(devModeEnabledAtom);
  const {
    utilityPanelRef,
    submenuPanelRef,
    activeSubmenu,
    setActiveSubmenu,
    submenuPosition,
    utilityPanel,
    setUtilityPanel,
    utilityPanelPosition,
    isOpen,
    isPositioned,
    triggerRef,
    panelRef,
    panelPosition,
    closeAll,
    handleToggle,
    openSubmenu,
    handleViewRam,
    handleSubmenuPointerDown,
    handleSubmenuMouseDown,
  } = useSidebarSettingsMenuPopovers({ renderTrigger });
  const { appearanceMode, appearanceModeOptions, handleAppearanceModeChange } =
    useAppearanceState();

  const openSettingsShortcut = useShortcutKeys("open_settings");

  useSidebarUtilityPanelDismiss({
    utilityPanel,
    utilityPanelRef,
    setUtilityPanel,
  });

  const {
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
  } = useSidebarSettingsMenuActions({
    closeAll,
    goToSettings,
    handleAppearanceModeChange,
  });

  return (
    <>
      <SidebarSettingsMenuTriggerSlot
        renderTrigger={renderTrigger}
        isOpen={isOpen}
        handleToggle={handleToggle}
        triggerRef={triggerRef}
        openSettingsShortcut={openSettingsShortcut}
      />

      {isOpen &&
        isPositioned &&
        createPortal(
          <div
            ref={panelRef}
            className={`${DROPDOWN_CLASSES.menuPanelBase} ${DROPDOWN_WIDTHS.sidebarMenuClass} fixed`}
            style={{
              top: panelPosition.top,
              bottom: panelPosition.bottom,
              left: panelPosition.left,
            }}
          >
            <div className={DROPDOWN_CLASSES.itemsColumn}>
              <SidebarSettingsMenuLeadingItems
                signedIn={signedIn}
                devModeEnabled={devModeEnabled}
                setActiveSubmenu={setActiveSubmenu}
                handleOpenWiki={handleOpenWiki}
                handleSignOut={handleSignOut}
                handleViewRam={handleViewRam}
              />
              <SidebarSettingsMenuSubmenuTriggers
                activeSubmenu={activeSubmenu}
                openSubmenu={openSubmenu}
              />
              <div className={DROPDOWN_CLASSES.menuGroupSeparator} />
              <SidebarSettingsMenuTrailingItems
                signedIn={signedIn}
                onSignIn={onSignIn}
                openSettingsShortcut={openSettingsShortcut}
                setActiveSubmenu={setActiveSubmenu}
                handleOpenSettings={handleOpenSettings}
                handleSignIn={handleSignIn}
              />
            </div>
          </div>,
          document.body
        )}
      {showSignInModal && (
        <SignInModal
          onClose={() => setShowSignInModal(false)}
          onSignIn={onSignIn}
        />
      )}
      {showSignOutConfirmation && (
        <SignOutConfirmationModal
          onClose={() => setShowSignOutConfirmation(false)}
        />
      )}
      <SidebarSettingsMenuSubmenus
        activeSubmenu={activeSubmenu}
        appearanceMode={appearanceMode}
        themeLabel={tSettings("general.theme")}
        appearanceModeOptions={appearanceModeOptions}
        modifyAppearanceLabel={t("sidebar.settingsMenu.modifyAppearance")}
        submenuPanelRef={submenuPanelRef}
        submenuPosition={submenuPosition}
        onModifyAppearance={handleModifyAppearance}
        onSelectAppearanceMode={(mode) => void handleSelectAppearanceMode(mode)}
        onSubmenuMouseDown={handleSubmenuMouseDown}
        onSubmenuPointerDown={handleSubmenuPointerDown}
      />
      {devModeEnabled && utilityPanel === "ram" && utilityPanelPosition && (
        <SidebarRamMonitorPanel
          isOpen
          panelRef={utilityPanelRef}
          panelPosition={utilityPanelPosition}
        />
      )}
    </>
  );
};

SidebarSettingsMenuButton.displayName = "SidebarSettingsMenuButton";

export default React.memo(SidebarSettingsMenuButton);
