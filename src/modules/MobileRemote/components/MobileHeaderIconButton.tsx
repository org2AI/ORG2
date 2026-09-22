import React, { forwardRef } from "react";

import Button from "@src/components/Button";
import { Cancel01Icon, HugeiconsIcon, type IconSvgElement } from "@src/icons";

import "./mobileHeaderIconButton.scss";

interface MobileHeaderIconButtonProps {
  label: string;
  onClick: () => void;
  icon?: IconSvgElement;
  className?: string;
}

/** One touch-sized, uncompressed icon treatment for mobile sheet headers. */
export const MobileHeaderIconButton = forwardRef<
  HTMLButtonElement,
  MobileHeaderIconButtonProps
>(function MobileHeaderIconButton(
  { label, onClick, icon = Cancel01Icon, className = "" },
  ref
) {
  return (
    <Button
      ref={ref}
      iconOnly
      shape="circle"
      variant="tertiary"
      className={`mobile-header-icon-button ${className}`}
      style={{
        width: "var(--mobile-header-icon-button-size)",
        height: "var(--mobile-header-icon-button-size)",
        padding: 0,
      }}
      aria-label={label}
      onClick={onClick}
      icon={
        <HugeiconsIcon
          icon={icon}
          size={20}
          strokeWidth={2}
          className="shrink-0"
          aria-hidden="true"
        />
      }
    />
  );
});
