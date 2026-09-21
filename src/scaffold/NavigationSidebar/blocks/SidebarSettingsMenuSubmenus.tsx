import React from "react";
import { createPortal } from "react-dom";

import { PILL_SM_ICON_SIZE } from "@src/components/CompoundPill/config";
import DropdownItem from "@src/components/Dropdown/DropdownItem";
import { MenuSegmentedRow } from "@src/components/Dropdown/MenuControlRows";
import type { SubmenuAnchor } from "@src/components/Dropdown/submenuLayout";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_WIDTHS,
} from "@src/components/Dropdown/tokens";
import type { AppearanceMode } from "@src/config/appearance/globalThemes";
import { APPEARANCE_MODE_ICONS } from "@src/config/appearance/quickMenuOptions";
import { ArrowUpRight01Icon, HugeiconsIcon } from "@src/icons";

import { PresenceMenuItems } from "./SidebarBottomBar";
import { SidebarLayoutSettingsSubmenu } from "./SidebarLayoutSettingsSubmenu";

export type SettingsSubmenu = "presence" | "appearance" | "layout";

/** Placement of a settings submenu, computed by the shared submenu geometry. */
export type SubmenuPosition = SubmenuAnchor;

interface AppearanceOption {
  value: AppearanceMode;
  label: string;
}

interface SidebarSettingsMenuSubmenusProps {
  activeSubmenu: SettingsSubmenu | null;
  appearanceMode: AppearanceMode;
  themeLabel: string;
  appearanceModeOptions: readonly AppearanceOption[];
  modifyAppearanceLabel: string;
  submenuPanelRef: React.Ref<HTMLDivElement>;
  submenuPosition: SubmenuPosition | null;
  onModifyAppearance: () => void;
  onSelectAppearanceMode: (mode: AppearanceMode) => void;
  onSubmenuMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void;
  onSubmenuPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
}

export function SidebarSettingsMenuSubmenus({
  activeSubmenu,
  appearanceMode,
  themeLabel,
  appearanceModeOptions,
  modifyAppearanceLabel,
  submenuPanelRef,
  submenuPosition,
  onModifyAppearance,
  onSelectAppearanceMode,
  onSubmenuMouseDown,
  onSubmenuPointerDown,
}: SidebarSettingsMenuSubmenusProps): React.ReactPortal | null {
  if (!activeSubmenu || !submenuPosition) return null;

  if (activeSubmenu === "presence") {
    return createPortal(
      <div
        ref={submenuPanelRef}
        className={`${DROPDOWN_CLASSES.menuPanelBase} ${DROPDOWN_WIDTHS.panelWidthClass} fixed`}
        style={{ left: submenuPosition.left, top: submenuPosition.top }}
        onPointerDown={onSubmenuPointerDown}
        onMouseDown={onSubmenuMouseDown}
      >
        <PresenceMenuItems />
      </div>,
      document.body
    );
  }

  if (activeSubmenu === "layout") {
    return createPortal(
      <SidebarLayoutSettingsSubmenu
        panelRef={submenuPanelRef}
        position={submenuPosition}
        onPointerDown={onSubmenuPointerDown}
        onMouseDown={onSubmenuMouseDown}
      />,
      document.body
    );
  }

  if (activeSubmenu === "appearance") {
    const appearanceModePillOptions = appearanceModeOptions.map((option) => {
      return {
        value: option.value,
        ariaLabel: option.label,
        label: (
          <HugeiconsIcon
            icon={APPEARANCE_MODE_ICONS[option.value]}
            data-icon={`theme-${option.value}`}
            size={PILL_SM_ICON_SIZE}
            strokeWidth={1.75}
            className="block"
            aria-hidden
          />
        ),
      };
    });

    return createPortal(
      <div
        ref={submenuPanelRef}
        className={`${DROPDOWN_CLASSES.menuPanelWithHeaderBase} ${DROPDOWN_WIDTHS.panelWidthClass} fixed`}
        style={{ left: submenuPosition.left, top: submenuPosition.top }}
        onPointerDown={onSubmenuPointerDown}
        onMouseDown={onSubmenuMouseDown}
      >
        <div
          className={`${DROPDOWN_CLASSES.itemsColumnPadded} scrollbar-overlay max-h-80 overflow-y-auto`}
        >
          <MenuSegmentedRow
            label={themeLabel}
            value={appearanceMode}
            options={appearanceModePillOptions}
            onChange={onSelectAppearanceMode}
          />
          <div className={DROPDOWN_CLASSES.menuGroupSeparator} />
          <DropdownItem
            fullWidth
            tabIndex={0}
            onClick={onModifyAppearance}
            role="menuitem"
            suffix={
              <HugeiconsIcon
                icon={ArrowUpRight01Icon}
                data-icon="arrow-up-right"
                size={13}
                strokeWidth={2}
                className="text-text-3"
              />
            }
          >
            {modifyAppearanceLabel}
          </DropdownItem>
        </div>
      </div>,
      document.body
    );
  }

  return null;
}
