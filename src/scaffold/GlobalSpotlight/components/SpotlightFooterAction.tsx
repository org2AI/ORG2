/**
 * SpotlightFooterAction Component
 *
 * Small clickable pill rendered alongside the keyboard-shortcuts footer.
 */
import React from "react";

import { ArrowUpRight01Icon, HugeiconsIcon } from "@src/icons";

interface SpotlightFooterActionProps {
  label: string;
  onClick: () => void;
}

export const SpotlightFooterAction: React.FC<SpotlightFooterActionProps> = ({
  label,
  onClick,
}) => {
  return (
    <div className="h-9 shrink-0 overflow-hidden rounded-full border border-border-2 bg-bg-2 shadow-lg">
      <button
        type="button"
        onClick={onClick}
        className="flex h-full items-center gap-1.5 px-3 text-[11px] text-text-2 transition-colors hover:bg-fill-2 hover:text-text-1"
      >
        <span>{label}</span>
        <HugeiconsIcon
          icon={ArrowUpRight01Icon}
          data-icon="arrow-up-right"
          size={10}
          strokeWidth={2.5}
        />
      </button>
    </div>
  );
};
