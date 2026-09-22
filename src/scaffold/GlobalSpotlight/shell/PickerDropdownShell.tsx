import { type HTMLAttributes, forwardRef } from "react";
import { createPortal } from "react-dom";

import DropdownPanel from "@src/components/Dropdown/DropdownPanel";
import { DROPDOWN_PANEL } from "@src/components/Dropdown/tokens";
import { getDropdownPanelStyle } from "@src/hooks/dropdown/dropdownPanelStyle";
import type { DropdownEnginePosition } from "@src/hooks/dropdown/useDropdownEngine";
import { getViewportSize } from "@src/util/ui/window/viewport";

export function getPickerDropdownBounds(
  position: DropdownEnginePosition,
  preferredWidth: number,
  viewportWidth: number,
  align: "start" | "center" = "start"
) {
  const margin = DROPDOWN_PANEL.viewportPadding;
  const width = Math.max(
    0,
    Math.min(preferredWidth, viewportWidth - margin * 2)
  );
  const anchorLeft =
    position.right === undefined
      ? position.left
      : viewportWidth - position.right - position.width;
  const desiredLeft =
    anchorLeft + (align === "center" ? (position.width - width) / 2 : 0);
  const left = Math.max(
    margin,
    Math.min(desiredLeft, viewportWidth - margin - width)
  );
  return { left, width };
}

interface PickerDropdownShellProps extends HTMLAttributes<HTMLDivElement> {
  position: DropdownEnginePosition;
  preferredWidth: number;
  align?: "start" | "center";
  /** A model picker already portals its main and auxiliary panels together. */
  portal?: boolean;
}

/** Surface only: the caller's existing engine owns positioning and keyboard lifecycle. */
export const PickerDropdownShell = forwardRef<
  HTMLDivElement,
  PickerDropdownShellProps
>(
  (
    {
      position,
      preferredWidth,
      align,
      portal = true,
      children,
      className = "",
      style,
      ...props
    },
    ref
  ) => {
    const bounds = getPickerDropdownBounds(
      position,
      preferredWidth,
      getViewportSize().width,
      align
    );
    const panel = (
      <DropdownPanel
        {...props}
        ref={ref}
        animated={false}
        className={`fixed flex min-h-0 flex-col overflow-hidden ${className}`}
        style={{
          ...getDropdownPanelStyle(position, { widthMode: "none" }),
          right: undefined,
          ...bounds,
          ...style,
        }}
      >
        {children}
      </DropdownPanel>
    );
    return portal ? createPortal(panel, document.body) : panel;
  }
);
PickerDropdownShell.displayName = "PickerDropdownShell";
