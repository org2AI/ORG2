import React from "react";

import { SETTINGS_TABLE_CELL } from "@src/components/SettingsTable/tokens";

interface EnabledFractionTextProps {
  enabled: number;
  total: number;
  className?: string;
}

/**
 * Consistent enabled/total count for Integrations tables and inline card headers.
 * Numerator uses emphasis styling; denominator is muted.
 */
export const EnabledFractionText: React.FC<EnabledFractionTextProps> = ({
  enabled,
  total,
  className,
}) => {
  if (total <= 0) return null;

  return (
    <span
      className={`whitespace-nowrap tabular-nums ${className ?? ""}`.trim()}
    >
      <span className={SETTINGS_TABLE_CELL.value}>{enabled}</span>
      <span className="text-text-4">/</span>
      <span className={SETTINGS_TABLE_CELL.muted}>{total}</span>
    </span>
  );
};
