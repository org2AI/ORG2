import React from "react";
import { useTranslation } from "react-i18next";

import DropdownActionItem from "@src/components/Dropdown/DropdownActionItem";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_ITEM,
} from "@src/components/Dropdown/tokens";
import {
  ArrowRight01Icon,
  BookOpen01Icon,
  CircleIcon,
  ContrastIcon,
  GaugeIcon,
  HugeiconsIcon,
  Layout01Icon,
  Login02Icon,
  Logout02Icon,
  Settings01Icon,
} from "@src/icons";

import type { SettingsSubmenu } from "./SidebarSettingsMenuSubmenus";

const MENU_ICON_CLASS_NAME = "shrink-0 text-text-2";
const MENU_ARROW_CLASS_NAME = "shrink-0 text-text-3";

type SetActiveSubmenu = React.Dispatch<
  React.SetStateAction<SettingsSubmenu | null>
>;

interface SidebarSettingsMenuLeadingItemsProps {
  signedIn: boolean;
  devModeEnabled: boolean;
  setActiveSubmenu: SetActiveSubmenu;
  handleOpenWiki: () => void;
  handleSignOut: () => void;
  handleViewRam: () => void;
}

/** Sign out (signed-in only), Wiki, and View RAM (dev mode only). */
export function SidebarSettingsMenuLeadingItems({
  signedIn,
  devModeEnabled,
  setActiveSubmenu,
  handleOpenWiki,
  handleSignOut,
  handleViewRam,
}: SidebarSettingsMenuLeadingItemsProps): React.ReactElement {
  const { t } = useTranslation("navigation");

  return (
    <>
      {signedIn && (
        <>
          <DropdownActionItem
            icon={
              <HugeiconsIcon
                icon={Logout02Icon}
                data-icon="log-out"
                size={DROPDOWN_ITEM.iconSize}
                className={MENU_ICON_CLASS_NAME}
              />
            }
            onMouseEnter={() => setActiveSubmenu(null)}
            onFocus={() => setActiveSubmenu(null)}
            onClick={handleSignOut}
            data-testid="sidebar-menu-sign-out"
          >
            {t("cloud.signOut")}
          </DropdownActionItem>
          <div className={DROPDOWN_CLASSES.menuGroupSeparator} />
        </>
      )}
      <DropdownActionItem
        icon={
          <HugeiconsIcon
            icon={BookOpen01Icon}
            size={DROPDOWN_ITEM.iconSize}
            className={MENU_ICON_CLASS_NAME}
          />
        }
        onMouseEnter={() => setActiveSubmenu(null)}
        onFocus={() => setActiveSubmenu(null)}
        onClick={handleOpenWiki}
        aria-haspopup="dialog"
        data-testid="sidebar-menu-wiki"
      >
        Wiki
      </DropdownActionItem>
      {devModeEnabled && (
        <DropdownActionItem
          icon={
            <HugeiconsIcon
              icon={GaugeIcon}
              data-icon="gauge"
              size={DROPDOWN_ITEM.iconSize}
              className={MENU_ICON_CLASS_NAME}
            />
          }
          onMouseEnter={() => setActiveSubmenu(null)}
          onFocus={() => setActiveSubmenu(null)}
          onClick={handleViewRam}
        >
          {t("sidebar.settingsMenu.viewRam")}
        </DropdownActionItem>
      )}
    </>
  );
}

interface SidebarSettingsMenuSubmenuTriggersProps {
  activeSubmenu: SettingsSubmenu | null;
  openSubmenu: (submenu: SettingsSubmenu, target: HTMLElement) => void;
}

/** Presence, Appearance and Layout: rows that open a submenu on hover or focus. */
export function SidebarSettingsMenuSubmenuTriggers({
  activeSubmenu,
  openSubmenu,
}: SidebarSettingsMenuSubmenuTriggersProps): React.ReactElement {
  const { t } = useTranslation("navigation");
  const { t: tSettings } = useTranslation("settings");

  return (
    <>
      <DropdownActionItem
        active={activeSubmenu === "presence"}
        icon={
          <HugeiconsIcon
            icon={CircleIcon}
            data-icon="circle"
            size={DROPDOWN_ITEM.iconSize}
            className="shrink-0 text-success-6"
          />
        }
        suffix={
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            data-icon="chevron-right"
            size={DROPDOWN_ITEM.iconSize}
            className={MENU_ARROW_CLASS_NAME}
          />
        }
        onMouseEnter={(event) => openSubmenu("presence", event.currentTarget)}
        onFocus={(event) => openSubmenu("presence", event.currentTarget)}
      >
        {tSettings("myRoles.tabs.presence")}
      </DropdownActionItem>
      <DropdownActionItem
        active={activeSubmenu === "appearance"}
        icon={
          <HugeiconsIcon
            icon={ContrastIcon}
            data-icon="contrast"
            size={DROPDOWN_ITEM.iconSize}
            className={MENU_ICON_CLASS_NAME}
          />
        }
        suffix={
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            data-icon="chevron-right"
            size={DROPDOWN_ITEM.iconSize}
            className={MENU_ARROW_CLASS_NAME}
          />
        }
        onMouseEnter={(event) => openSubmenu("appearance", event.currentTarget)}
        onFocus={(event) => openSubmenu("appearance", event.currentTarget)}
      >
        {t("sidebar.settingsMenu.appearance")}
      </DropdownActionItem>
      <DropdownActionItem
        active={activeSubmenu === "layout"}
        icon={
          <HugeiconsIcon
            icon={Layout01Icon}
            data-icon="layout"
            size={DROPDOWN_ITEM.iconSize}
            className={MENU_ICON_CLASS_NAME}
          />
        }
        suffix={
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            data-icon="chevron-right"
            size={DROPDOWN_ITEM.iconSize}
            className={MENU_ARROW_CLASS_NAME}
          />
        }
        onMouseEnter={(event) => openSubmenu("layout", event.currentTarget)}
        onFocus={(event) => openSubmenu("layout", event.currentTarget)}
        data-testid="sidebar-settings-layout"
      >
        {tSettings("general.layout")}
      </DropdownActionItem>
    </>
  );
}

interface SidebarSettingsMenuTrailingItemsProps {
  signedIn: boolean;
  onSignIn?: () => void;
  openSettingsShortcut: string;
  setActiveSubmenu: SetActiveSubmenu;
  handleOpenSettings: () => void;
  handleSignIn: () => void;
}

/** Open settings, and Sign in (signed out, with `onSignIn`). */
export function SidebarSettingsMenuTrailingItems({
  signedIn,
  onSignIn,
  openSettingsShortcut,
  setActiveSubmenu,
  handleOpenSettings,
  handleSignIn,
}: SidebarSettingsMenuTrailingItemsProps): React.ReactElement {
  const { t } = useTranslation("navigation");

  return (
    <>
      <DropdownActionItem
        icon={
          <HugeiconsIcon
            icon={Settings01Icon}
            data-icon="settings"
            size={DROPDOWN_ITEM.iconSize}
            className={MENU_ICON_CLASS_NAME}
          />
        }
        shortcut={openSettingsShortcut}
        onMouseEnter={() => setActiveSubmenu(null)}
        onFocus={() => setActiveSubmenu(null)}
        onClick={handleOpenSettings}
      >
        {t("sidebar.settingsMenu.openSettings")}
      </DropdownActionItem>
      {!signedIn && onSignIn && (
        <>
          <div className={DROPDOWN_CLASSES.menuGroupSeparator} />
          <DropdownActionItem
            icon={
              <HugeiconsIcon
                icon={Login02Icon}
                data-icon="log-in"
                size={DROPDOWN_ITEM.iconSize}
                className={MENU_ICON_CLASS_NAME}
              />
            }
            onMouseEnter={() => setActiveSubmenu(null)}
            onFocus={() => setActiveSubmenu(null)}
            onClick={handleSignIn}
            data-testid="sidebar-menu-sign-in"
          >
            {t("cloud.signIn")}
          </DropdownActionItem>
        </>
      )}
    </>
  );
}
