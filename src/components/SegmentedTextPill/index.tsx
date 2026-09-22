import type { ReactNode } from "react";

import Button from "@src/components/Button";
import Tooltip, { type TooltipProps } from "@src/components/Tooltip";
import { useCurrentTheme } from "@src/util/ui/theme/themeUtils";

interface SegmentedTextPillOption<T extends string> {
  ariaLabel?: string;
  disabled?: boolean;
  label: ReactNode;
  tooltip?: ReactNode;
  value: T;
}

type SegmentedTextPillSize = "small" | "default" | "large";

export interface SegmentedTextPillProps<T extends string> {
  ariaLabel: string;
  className?: string;
  dataTestId?: string;
  onChange: (value: T) => void;
  options: SegmentedTextPillOption<T>[];
  size?: SegmentedTextPillSize;
  tooltipPosition?: TooltipProps["position"];
  /** When null, no segment is shown as selected (e.g. custom value outside presets). */
  value: T | null;
}

const CONTAINER_SIZE_CLASSES: Record<SegmentedTextPillSize, string> = {
  small: "h-6 text-[11px] font-medium",
  default: "h-[28px] text-[12px] font-medium",
  large: "h-8 text-sm font-normal",
};

const BUTTON_SIZE_CLASSES: Record<SegmentedTextPillSize, string> = {
  small: "h-5 px-2",
  default: "h-6 px-2.5",
  large: "h-7 px-3",
};

const SELECTED_WEIGHT_CLASSES: Record<SegmentedTextPillSize, string> = {
  small: "font-medium",
  default: "font-medium",
  large: "font-normal",
};

const SELECTED_SHADOW_CLASSES: Record<SegmentedTextPillSize, string> = {
  small: "shadow-dropdown-soft",
  default: "shadow-dropdown-soft",
  large: "shadow-none",
};

/** Compact segmented control with optional tooltips and accessible icon labels. */
export default function SegmentedTextPill<T extends string>({
  ariaLabel,
  className = "",
  dataTestId,
  onChange,
  options,
  size = "default",
  tooltipPosition = "top",
  value,
}: SegmentedTextPillProps<T>) {
  const { isDark } = useCurrentTheme();

  return (
    <div
      aria-label={ariaLabel}
      className={`inline-flex shrink-0 items-center rounded-full ${isDark ? "bg-fill-3" : "bg-fill-2"} p-0.5 ${CONTAINER_SIZE_CLASSES[size]} ${className}`}
      data-testid={dataTestId}
      role="group"
    >
      {options.map((option) => {
        const selected = value != null && option.value === value;

        const button = (
          <Button
            layout="custom"
            key={option.value}
            className={`inline-flex items-center justify-center rounded-full py-0 transition-colors ${BUTTON_SIZE_CLASSES[size]} ${
              selected
                ? `bg-bg-2 text-text-1 ${SELECTED_WEIGHT_CLASSES[size]} ${SELECTED_SHADOW_CLASSES[size]}`
                : "text-text-3 hover:text-text-1"
            } ${option.disabled ? "cursor-not-allowed opacity-50" : ""}`}
            disabled={option.disabled}
            aria-label={option.ariaLabel}
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </Button>
        );

        return option.tooltip ? (
          <Tooltip
            key={option.value}
            content={option.tooltip}
            position={tooltipPosition}
            kind="button"
            framedPanel
            smartPlacement
          >
            {button}
          </Tooltip>
        ) : (
          button
        );
      })}
    </div>
  );
}
