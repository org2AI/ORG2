import type React from "react";

import Button, { type ButtonProps } from "@src/components/Button";
import {
  KEYBOARD_SHORTCUT_VARIANT,
  KeyboardShortcut,
} from "@src/components/KeyboardShortcut";

import { DROPDOWN_CLASSES, DROPDOWN_ITEM } from "./tokens";

export interface DropdownActionItemProps extends Omit<
  ButtonProps,
  "appearance" | "children" | "icon" | "layout" | "shortcut"
> {
  /** Destructive action styling; disabled rows retain the standard muted state. */
  danger?: boolean;
  /** Primary row label. */
  children: React.ReactNode;
  /** Leading icon, normalized to the shared dropdown icon slot. */
  icon?: React.ReactNode;
  /** Display-only shortcut text. The caller owns keyboard handling. */
  shortcut?: string;
  /** Registered shortcut whose current binding should be displayed. */
  shortcutId?: string;
  /** Optional content after the shortcut, such as a submenu chevron. */
  suffix?: React.ReactNode;
  /** Persistent hover-style fill for an open submenu or active row. */
  active?: boolean;
  /** Additional class for the truncating label slot. */
  labelClassName?: string;
  /** Additional class for the shortcut wrapper. */
  shortcutClassName?: string;
}

/**
 * Shared native-button row for dropdown action menus.
 *
 * It owns the sidebar-settings menu proportions and keeps shortcut hints in a
 * dedicated trailing slot, so action-menu callers do not rebuild either.
 */
export function DropdownActionItem({
  active = false,
  children,
  className = "",
  disabled = false,
  danger = false,
  icon,
  labelClassName = "",
  role = "menuitem",
  shortcut,
  shortcutClassName = "",
  shortcutId,
  suffix,
  ...buttonProps
}: DropdownActionItemProps) {
  const hasShortcut = Boolean(shortcut?.trim() || shortcutId);

  return (
    <Button
      {...buttonProps}
      layout="custom"
      htmlType={buttonProps.htmlType ?? "button"}
      role={role}
      disabled={disabled}
      className={`${DROPDOWN_CLASSES.menuActionItem} ${
        active
          ? danger && !disabled
            ? DROPDOWN_CLASSES.itemDangerActive
            : DROPDOWN_CLASSES.itemActive
          : ""
      } ${disabled ? DROPDOWN_CLASSES.itemDisabled : danger ? `${DROPDOWN_CLASSES.itemDanger} ${DROPDOWN_CLASSES.itemDangerHover}` : ""} ${className}`}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">
        {icon ? (
          <span
            className={`flex ${DROPDOWN_ITEM.iconSizeClass} shrink-0 items-center justify-center ${danger && !disabled ? DROPDOWN_CLASSES.itemDangerIcon : "text-text-2"} [&_svg]:h-full [&_svg]:w-full`}
          >
            {icon}
          </span>
        ) : null}
        <span className={`min-w-0 flex-1 truncate ${labelClassName}`}>
          {children}
        </span>
      </span>
      {hasShortcut ? (
        <KeyboardShortcut
          shortcut={shortcut}
          shortcutId={shortcutId}
          variant={KEYBOARD_SHORTCUT_VARIANT.dropdown}
          className={`ml-auto ${shortcutClassName}`}
        />
      ) : null}
      {suffix ? (
        <span
          className={`${hasShortcut ? "ml-1" : "ml-auto"} shrink-0 text-text-3`}
        >
          {suffix}
        </span>
      ) : null}
    </Button>
  );
}

export default DropdownActionItem;
