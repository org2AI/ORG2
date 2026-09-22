import React, { memo } from "react";

import Button from "@src/components/Button";
import {
  Alert01Icon,
  ArrowDown01Icon,
  ArrowRight01Icon,
  HugeiconsIcon,
} from "@src/icons";

interface OverviewSectionToggleProps {
  expanded: boolean;
  label: string;
  count: number;
  onToggle: () => void;
  testId: string;
  blockedCount?: number;
  blockedLabel?: string;
}

const OverviewSectionToggle: React.FC<OverviewSectionToggleProps> = memo(
  ({
    expanded,
    label,
    count,
    onToggle,
    testId,
    blockedCount = 0,
    blockedLabel,
  }) => (
    <Button
      layout="custom"
      className="flex w-full items-center gap-1 px-1 text-left text-[11px] font-medium text-text-2 hover:text-text-1 focus-visible:ring-2 focus-visible:ring-primary-6/30 focus-visible:outline-none"
      aria-expanded={expanded}
      onClick={onToggle}
      data-testid={testId}
    >
      <HugeiconsIcon
        icon={expanded ? ArrowDown01Icon : ArrowRight01Icon}
        data-icon={expanded ? "chevron-down" : "chevron-right"}
        size={11}
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {blockedCount > 0 && (
        <span
          className="inline-flex shrink-0 items-center gap-0.5 text-[10px] text-warning-6"
          title={`${blockedLabel}: ${blockedCount}`}
          aria-label={`${blockedLabel}: ${blockedCount}`}
        >
          <HugeiconsIcon
            icon={Alert01Icon}
            data-icon="alert"
            size={10}
            strokeWidth={2}
          />
          {blockedCount}
        </span>
      )}
      <span className="shrink-0 text-[10px] text-text-3">{count}</span>
    </Button>
  )
);

OverviewSectionToggle.displayName = "OverviewSectionToggle";

export default OverviewSectionToggle;
