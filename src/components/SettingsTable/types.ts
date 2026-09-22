/**
 * Shared SettingsTable types.
 *
 * These live outside `index.tsx` so presentation modules (the card grid, cell
 * renderers) can describe columns without importing the table component back
 * from the barrel. Everything here is re-exported from
 * `@src/components/SettingsTable` — consumers keep importing from the barrel.
 */
import type React from "react";
import type { ReactNode } from "react";

import type { SelectOption, SelectProps } from "@src/components/Select";

export interface SettingsTableColumn<RowData> {
  key: string;
  label: ReactNode;
  width?: React.CSSProperties["width"];
  align?: "left" | "center" | "right";
  /** Legacy: SettingsTable now preserves columns and relies on internal horizontal scrolling. */
  hideBelow?: "sm" | "md";
  sorter?: boolean | ((rowA: RowData, rowB: RowData) => number);
  renderCell: (rowData: RowData) => ReactNode;
  /** When provided, appends an info icon with tooltip after cell content. */
  cellInfoTooltip?: (rowData: RowData) => string | undefined;
}

/** Select filter descriptor for the search bar area. */
export interface SettingsTableSelectFilter {
  key: string;
  value: string | number;
  /** The "all / unfiltered" value. When `value !== defaultValue` the trigger text turns primary-6. */
  defaultValue: string | number;
  options: SelectOption[];
  onChange: (value: string | number) => void;
  /** Minimum dropdown panel width. Default: {@link SETTINGS_TABLE_FILTER_MIN_WIDTH}. */
  minWidth?: number;
  /** Show a search box in the dropdown. Defaults to on once the filter has
   *  more options than {@link SETTINGS_TABLE_FILTER_SEARCH_THRESHOLD}. */
  searchable?: boolean;
  /** Defaults to the compact toolbar's ghost appearance. */
  appearance?: SelectProps["appearance"];
}

export interface SettingsTablePaginationContext {
  pageIndex: number;
  pageSize: number;
  total: number;
  pageCount: number;
  canPreviousPage: boolean;
  canNextPage: boolean;
  onPageChange: (pageIndex: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

export type SettingsTableSurfaceVariant = "default" | "transparent";

export type SettingsTableBodySurface = "raised" | "pane";

/**
 * Card presentation for the same rows and columns the table body renders.
 *
 * Pass it as SettingsTable's `cardView` prop and flip `enabled` to switch
 * between the row list and the card grid; everything else in the table —
 * toolbar, filters, expandable rows, footer, pagination — behaves the same in
 * both modes. Column header sorting has no card equivalent: offer sorting
 * through the toolbar's `sortOptions` when a card-view table needs it.
 */
export interface SettingsTableCardViewConfig<RowData> {
  /** Render rows as cards instead of table rows. */
  enabled: boolean;
  /** Column rendered as the card heading. Default: the first column. */
  titleColumnKey?: string;
  /** Columns pinned to the heading's right edge, rendered without their label. */
  actionColumnKeys?: string[];
  /** Columns left out of the card entirely. */
  omitColumnKeys?: string[];
  /** Render each remaining column's label above its value. Default: true. */
  showFieldLabels?: boolean;
  /** How a labelled field sits in the card. "stacked" (default) puts the label
   *  above its value; "inline" keeps both on one line, label left, value right
   *  — the better fit for short values like a count or a status. */
  fieldLayout?: "stacked" | "inline";
  /** Field columns that share one card line instead of getting a line each.
   *  Each group lists column keys in the order they should read; a group's
   *  members keep their own label + value pair and spread across the line.
   *  Use it for short values that belong together — two counts, for instance —
   *  so the card does not spend a row per number. Keys not named in any group
   *  keep their own line, and a group whose members all render empty is
   *  dropped like any other empty field. */
  fieldRowGroups?: string[][];
  /** Minimum card width in px for the auto-fill grid. Default: 260. */
  minCardWidth?: number;
  /** Fixed column count. Overrides the `minCardWidth` auto-fill sizing. */
  columns?: number;
  /** Replaces the column-derived card content (heading, fields, actions). */
  renderCard?: (rowData: RowData) => ReactNode;
  /** Extra classes applied to every card. */
  cardClassName?: string | ((rowData: RowData, index: number) => string);
  /** When set, SettingsTable renders the list/card toggle in its own toolbar
   *  and calls this with the mode the user picked, so adopting the card view
   *  costs one prop rather than a hand-built button per table. */
  onEnabledChange?: (enabled: boolean) => void;
}
