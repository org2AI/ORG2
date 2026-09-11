import React from "react";

import Button from "@src/components/Button";
import { ArrowLeft01Icon, HugeiconsIcon } from "@src/icons";

export interface MobileTopBarProps {
  title?: React.ReactNode;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  onBack?: () => void;
  backAriaLabel?: string;
}

export function MobileTopBar({
  title,
  leading,
  trailing,
  onBack,
  backAriaLabel = "Back",
}: MobileTopBarProps) {
  return (
    <header
      className={`mobile-top-bar ${onBack ? "mobile-top-bar--detail" : "mobile-top-bar--root"}`}
    >
      {onBack ? (
        <Button
          htmlType="button"
          size="mini"
          variant="tertiary"
          className="mobile-chrome-icon-button"
          aria-label={backAriaLabel}
          onClick={onBack}
          style={{
            width: "var(--mobile-touch-size)",
            height: "var(--mobile-touch-size)",
          }}
          appearance="soft"
          iconOnly
          icon={<HugeiconsIcon icon={ArrowLeft01Icon} size={22} />}
        />
      ) : leading ? (
        <div className="mobile-top-bar__leading">{leading}</div>
      ) : null}
      {title ? <h1 className="mobile-top-bar__title">{title}</h1> : null}
      {trailing ? (
        <div className="mobile-top-bar__trailing">{trailing}</div>
      ) : null}
    </header>
  );
}

MobileTopBar.displayName = "MobileTopBar";
