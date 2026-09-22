/**
 * Renders one SettingsTable column's cell, including its optional info
 * tooltip. Shared by the table body and the card grid so a column reads the
 * same in both presentations.
 */
import type { ReactNode } from "react";

import Tooltip from "@src/components/Tooltip";
import { HugeiconsIcon, InformationCircleIcon } from "@src/icons";

import type { SettingsTableColumn } from "./types";

export function renderSettingsTableCell<RowData>(
  column: SettingsTableColumn<RowData>,
  rowData: RowData
): ReactNode {
  const cell = column.renderCell(rowData);
  const tooltip = column.cellInfoTooltip?.(rowData);
  if (!tooltip) return cell;
  return (
    <div className="flex items-center gap-1.5">
      {cell}
      <Tooltip
        content={<span style={{ whiteSpace: "pre-line" }}>{tooltip}</span>}
        position="top"
        showArrow={false}
      >
        <span className="flex cursor-help items-center p-1">
          <HugeiconsIcon
            icon={InformationCircleIcon}
            data-icon="info"
            size={14}
            className="text-text-3"
          />
        </span>
      </Tooltip>
    </div>
  );
}
