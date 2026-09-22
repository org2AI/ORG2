import type { ButtonHTMLAttributes } from "react";

import Button from "@src/components/Button";
import { BUTTON_SIZE, HEADER_ICON_SIZE } from "@src/config/workstation/tokens";
import { HugeiconsIcon, StopCircleIcon } from "@src/icons";

interface ProcessStopButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children"
> {
  label: string;
  size?: keyof typeof BUTTON_SIZE;
  loading?: boolean;
}

/** Shared process termination affordance, matching the server watcher. */
export function ProcessStopButton({
  label,
  size = "md",
  loading = false,
  disabled,
  className = "",
  title = label,
  onClick,
  ...props
}: ProcessStopButtonProps) {
  return (
    <Button
      variant="tertiary"
      tone="danger"
      size={size === "sm" ? "sidebar" : size === "lg" ? "small" : "mini"}
      iconOnly
      icon={
        <HugeiconsIcon
          icon={StopCircleIcon}
          data-icon="stop"
          size={size === "lg" ? HEADER_ICON_SIZE.md : HEADER_ICON_SIZE.sm}
          aria-hidden
        />
      }
      {...props}
      aria-label={label}
      title={title}
      disabled={disabled}
      loading={loading}
      className={`shrink-0 ${className}`}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.(event);
      }}
    />
  );
}
