import React, { memo } from "react";

import Button from "@src/components/Button";
import { INPUT_AREA_BUTTONS } from "@src/config/inputAreaTokens";
import { ArrowUp02Icon, HugeiconsIcon } from "@src/icons";

export interface ComposerSubmitButtonProps {
  active: boolean;
  disabled?: boolean;
  busy?: boolean;
  tone?: "primary" | "warning";
  ariaLabel: string;
  onClick: React.MouseEventHandler<HTMLButtonElement>;
  state?: string;
  testId?: string;
  /** Shell-owned touch geometry; glyph size remains shared. */
  className?: string;
}

/** Shared Desktop/Mobile composer submit control. */
const ComposerSubmitButton: React.FC<ComposerSubmitButtonProps> = memo(
  ({
    active,
    disabled = false,
    busy = false,
    tone = "primary",
    ariaLabel,
    onClick,
    state = "submit",
    testId = "chat-send-button",
    className = "",
  }) => {
    const baseClass = `flex ${INPUT_AREA_BUTTONS.iconButtonSizeClass} shrink-0 items-center justify-center rounded-full leading-none transition-colors duration-200 focus:outline-none`;
    const activeClass =
      tone === "warning"
        ? "cursor-pointer border-none bg-warning-6 text-white hover:bg-warning-5"
        : INPUT_AREA_BUTTONS.iconButtonActive;
    const inactiveClass =
      tone === "warning"
        ? "border-none bg-warning-6 text-white opacity-50"
        : INPUT_AREA_BUTTONS.iconButtonInactive;

    return (
      <Button
        layout="custom"
        aria-label={ariaLabel}
        aria-busy={busy || undefined}
        disabled={disabled}
        onClick={onClick}
        className={`${baseClass} ${active ? activeClass : inactiveClass} ${className}`}
        style={{ lineHeight: 0 }}
        data-testid={testId}
        data-state={state}
      >
        <HugeiconsIcon
          icon={ArrowUp02Icon}
          data-icon="arrow-up"
          size={INPUT_AREA_BUTTONS.iconSize}
          strokeWidth={2}
          className="block text-white"
        />
      </Button>
    );
  }
);

ComposerSubmitButton.displayName = "ComposerSubmitButton";

export default ComposerSubmitButton;
