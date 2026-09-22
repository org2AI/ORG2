import type { ReactNode } from "react";
import React, { createContext, memo, useContext } from "react";

import { KeyboardShortcutTooltipContent } from "@src/components/KeyboardShortcut";
import Tooltip, { type TooltipProps } from "@src/components/Tooltip";
import { useShortcutKeys } from "@src/config/keyboard/useShortcutBindings";

type ToolbarTooltipPosition = NonNullable<TooltipProps["position"]>;

/**
 * The side a toolbar needs its tooltips on. A toolbar sitting directly above a
 * native webview (the Browser tab's URL bar) sets "top": tooltips cannot paint
 * over the webview, so one that opens downward is hidden. A side set here is a
 * requirement, not a preference — the tooltip is clamped inside the window
 * rather than flipped to the opposite side when space is tight.
 */
const ToolbarTooltipPositionContext =
  createContext<ToolbarTooltipPosition | null>(null);

export const ToolbarTooltipPositionProvider =
  ToolbarTooltipPositionContext.Provider;

export interface ToolbarTooltipProps {
  label: ReactNode;
  shortcut?: string;
  shortcutId?: string;
  /** The action deliberately has no shortcut: show the label alone. */
  noShortcut?: boolean;
  position?: TooltipProps["position"];
  /**
   * Keep `position` even when it does not fit: clamp inside the window instead
   * of flipping sides. Defaults to true under a ToolbarTooltipPositionProvider.
   */
  pinned?: boolean;
  disabled?: boolean;
  children: ReactNode;
}

export const ToolbarTooltip: React.FC<ToolbarTooltipProps> = memo(
  ({
    label,
    shortcut,
    shortcutId,
    noShortcut = false,
    position,
    pinned,
    disabled = false,
    children,
  }) => {
    const toolbarPosition = useContext(ToolbarTooltipPositionContext);
    const isPinned =
      pinned ?? (position === undefined && toolbarPosition !== null);
    const customizedShortcut = useShortcutKeys(shortcutId ?? "");
    const resolvedShortcut = shortcutId ? customizedShortcut : shortcut;

    return (
      <Tooltip
        content={
          <KeyboardShortcutTooltipContent
            label={label}
            shortcut={resolvedShortcut}
            noShortcut={noShortcut}
          />
        }
        position={position ?? toolbarPosition ?? "bottom"}
        kind="button"
        framedPanel
        disabled={disabled}
        smartPlacement={!isPinned}
      >
        <span className="inline-flex">{children}</span>
      </Tooltip>
    );
  }
);

ToolbarTooltip.displayName = "ToolbarTooltip";
