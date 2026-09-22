/**
 * SettingsTableCardGrid — card presentation for SettingsTable rows.
 *
 * Renders the same `SettingsTableColumn` definitions as a responsive grid of
 * cards instead of a table body: the title column becomes the card heading,
 * `actionColumnKeys` sit at the heading's right edge, and every other column
 * becomes a labelled field. An expanded row's detail does not grow its card:
 * it renders as a full-width panel below the card's grid row, the way the
 * table body drops a detail row under the row it belongs to, so wide detail
 * panels are never squeezed into a single grid track.
 *
 * Not rendered directly — reach it through SettingsTable's `cardView` prop.
 */
import React, { useMemo, useRef, useState } from "react";

import Button from "@src/components/Button";
import DisclosureChevron from "@src/components/DisclosureChevron";
import { Placeholder } from "@src/components/Placeholder";
import { isInteractiveTableTarget } from "@src/components/Table/TableBody";
import { InlineSurfaceProvider } from "@src/components/layout/blocks/inlineSurface";
import { useElementDimensions } from "@src/hooks/ui/layout/useElementDimensions";

import { renderSettingsTableCell } from "./renderSettingsTableCell";
import type {
  SettingsTableCardViewConfig,
  SettingsTableColumn,
  SettingsTablePaginationContext,
} from "./types";

const DEFAULT_MIN_CARD_WIDTH = 260;
/** Must stay in sync with the grid's `gap-2` (0.5rem) below — the column count
 *  is derived from it the same way `repeat(auto-fill, minmax(min, 1fr))` does. */
const GRID_GAP_PX = 8;

/** Columns CSS will lay out for the measured width, so detail panels can be
 *  placed after the last card of a row instead of inside it. */
export function resolveCardColumnCount(
  containerWidth: number,
  minCardWidth: number,
  fixedColumns?: number
): number {
  if (fixedColumns != null) return Math.max(1, fixedColumns);
  if (containerWidth <= 0) return 1;
  return Math.max(
    1,
    Math.floor((containerWidth + GRID_GAP_PX) / (minCardWidth + GRID_GAP_PX))
  );
}

export interface SettingsTableCardGridProps<RowData> {
  cardView: SettingsTableCardViewConfig<RowData>;
  columns: SettingsTableColumn<RowData>[];
  rows: RowData[];
  getRowKey: (rowData: RowData) => string;
  loading?: boolean;
  noDataElement?: React.ReactNode;
  expandable?: {
    expandedRowRender?: (
      record: RowData
    ) => React.ReactNode | React.ReactNode[][];
    rowExpandable?: (record: RowData) => boolean;
    expandedRowKeys?: string[];
    onExpandedRowsChange?: (keys: string[]) => void;
    onSubRowClick?: (parentRecord: RowData, subRowIndex: number) => void;
  };
  onRowClick?: (rowData: RowData) => void;
  rowDataTestId?: (rowData: RowData, index: number) => string | undefined;
  rowDataAttributes?: (
    rowData: RowData,
    index: number
  ) => Record<string, string | number | boolean | undefined> | undefined;
  /** Client-side page size. Omit to render every row. */
  pageSize?: number;
  renderPagination?: (ctx: SettingsTablePaginationContext) => React.ReactNode;
  expandLabels: { expand: string; collapse: string };
}

interface CardSlots<RowData> {
  titleColumn?: SettingsTableColumn<RowData>;
  actionColumns: SettingsTableColumn<RowData>[];
  fieldColumns: SettingsTableColumn<RowData>[];
}

function resolveCardSlots<RowData>(
  columns: SettingsTableColumn<RowData>[],
  cardView: SettingsTableCardViewConfig<RowData>
): CardSlots<RowData> {
  const omitted = new Set(cardView.omitColumnKeys ?? []);
  const visible = columns.filter((column) => !omitted.has(column.key));
  const actionKeys = new Set(cardView.actionColumnKeys ?? []);
  const titleColumn = cardView.titleColumnKey
    ? visible.find((column) => column.key === cardView.titleColumnKey)
    : visible.find((column) => !actionKeys.has(column.key));

  return {
    titleColumn,
    actionColumns: visible.filter((column) => actionKeys.has(column.key)),
    fieldColumns: visible.filter(
      (column) => column !== titleColumn && !actionKeys.has(column.key)
    ),
  };
}

/** Expanded content may be free-form or the table's column-aligned sub-rows;
 *  cards have no columns to align to, so sub-rows stack as plain rows. */
function renderExpandedContent<RowData>(
  row: RowData,
  rowKey: string,
  expandable: NonNullable<SettingsTableCardGridProps<RowData>["expandable"]>
): React.ReactNode {
  const content = expandable.expandedRowRender?.(row);
  if (content == null) return null;

  if (
    Array.isArray(content) &&
    content.length > 0 &&
    Array.isArray(content[0])
  ) {
    const subRows = content as React.ReactNode[][];
    const { onSubRowClick } = expandable;
    return (
      <div className="flex flex-col gap-1.5">
        {subRows.map((cells, subIndex) => (
          <div
            key={`${rowKey}-sub-${subIndex}`}
            className={`flex min-w-0 items-center justify-between gap-2 ${
              onSubRowClick ? "cursor-pointer" : ""
            }`.trim()}
            onClick={
              onSubRowClick
                ? (event) => {
                    if (isInteractiveTableTarget(event.target)) return;
                    onSubRowClick(row, subIndex);
                  }
                : undefined
            }
          >
            {cells.map((cell, cellIndex) => (
              <div key={cellIndex} className="min-w-0">
                {cell}
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  }

  return content;
}

export function SettingsTableCardGrid<RowData>({
  cardView,
  columns,
  rows,
  getRowKey,
  loading = false,
  noDataElement,
  expandable,
  onRowClick,
  rowDataTestId,
  rowDataAttributes,
  pageSize,
  renderPagination,
  expandLabels,
}: SettingsTableCardGridProps<RowData>) {
  const [pageIndex, setPageIndex] = useState(0);
  const [activePageSize, setActivePageSize] = useState(pageSize);
  const [uncontrolledExpandedKeys, setUncontrolledExpandedKeys] = useState<
    string[]
  >([]);

  const gridRef = useRef<HTMLDivElement>(null);
  const gridWidth = useElementDimensions(gridRef, { dimension: "width" });

  const slots = useMemo(
    () => resolveCardSlots(columns, cardView),
    [columns, cardView]
  );

  const effectivePageSize = activePageSize ?? pageSize;
  const paginated =
    effectivePageSize != null && rows.length > effectivePageSize;
  const pageCount = paginated
    ? Math.max(1, Math.ceil(rows.length / effectivePageSize))
    : 1;
  const safePageIndex = Math.min(pageIndex, pageCount - 1);
  const visibleRows = paginated
    ? rows.slice(
        safePageIndex * effectivePageSize,
        safePageIndex * effectivePageSize + effectivePageSize
      )
    : rows;

  const expandedKeys = expandable?.expandedRowKeys ?? uncontrolledExpandedKeys;
  const toggleExpanded = (rowKey: string) => {
    const next = expandedKeys.includes(rowKey)
      ? expandedKeys.filter((key) => key !== rowKey)
      : [...expandedKeys, rowKey];
    if (expandable?.expandedRowKeys == null) {
      setUncontrolledExpandedKeys(next);
    }
    expandable?.onExpandedRowsChange?.(next);
  };

  const minCardWidth = cardView.minCardWidth ?? DEFAULT_MIN_CARD_WIDTH;
  const columnCount = resolveCardColumnCount(
    gridWidth,
    minCardWidth,
    cardView.columns
  );

  const gridStyle: React.CSSProperties =
    cardView.columns != null
      ? { gridTemplateColumns: `repeat(${cardView.columns}, minmax(0, 1fr))` }
      : {
          gridTemplateColumns: `repeat(auto-fill, minmax(${minCardWidth}px, 1fr))`,
        };

  const showFieldLabels = cardView.showFieldLabels ?? true;
  const inlineFields = cardView.fieldLayout === "inline";

  if (loading) {
    return (
      <div className="px-4 py-10" role="status" aria-busy="true">
        <Placeholder variant="loading" />
      </div>
    );
  }

  if (rows.length === 0) {
    return <div className="px-4 py-8">{noDataElement}</div>;
  }

  // Cards are laid out row by row so an expanded card's detail can be emitted
  // after the last card of its row — a full-width panel under the row, never
  // inside the card.
  const gridRows: RowData[][] = [];
  for (let index = 0; index < visibleRows.length; index += columnCount) {
    gridRows.push(visibleRows.slice(index, index + columnCount));
  }

  return (
    <>
      <div ref={gridRef} className="grid gap-2 p-4" style={gridStyle}>
        {gridRows.map((gridRow, gridRowIndex) => {
          const expandedInRow = expandable
            ? gridRow.filter(
                (row) =>
                  (expandable.rowExpandable?.(row) ?? true) &&
                  expandable.expandedRowRender != null &&
                  expandedKeys.includes(getRowKey(row))
              )
            : [];

          return (
            <React.Fragment key={`grid-row-${gridRowIndex}`}>
              {gridRow.map((row, columnIndex) => {
                const index = gridRowIndex * columnCount + columnIndex;
                const rowKey = getRowKey(row);
                const canExpand =
                  expandable != null &&
                  (expandable.rowExpandable?.(row) ?? true) &&
                  expandable.expandedRowRender != null;
                const isExpanded = canExpand && expandedKeys.includes(rowKey);
                const clickable = onRowClick != null || canExpand;
                const extraClassName =
                  typeof cardView.cardClassName === "function"
                    ? cardView.cardClassName(row, index)
                    : cardView.cardClassName;

                return (
                  <div
                    key={rowKey}
                    data-testid={rowDataTestId?.(row, index)}
                    {...(rowDataAttributes?.(row, index) ?? {})}
                    data-expanded={isExpanded ? "true" : undefined}
                    className={[
                      "settings-table-card flex min-w-0 flex-col gap-2 rounded-lg border bg-bg-2 p-3 text-[13px] transition-colors",
                      // An open card is marked the way a focused Input is —
                      // primary border plus the same 2px 15% halo — so the
                      // detail panel under the row traces back to its card.
                      isExpanded
                        ? "border-primary-6 shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-primary-6)_15%,transparent)]"
                        : "border-border-2",
                      clickable &&
                        !isExpanded &&
                        "cursor-pointer hover:border-border-3",
                      clickable && isExpanded && "cursor-pointer",
                      extraClassName,
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={(event) => {
                      if (isInteractiveTableTarget(event.target)) return;
                      onRowClick?.(row);
                      if (canExpand) toggleExpanded(rowKey);
                    }}
                  >
                    {cardView.renderCard ? (
                      cardView.renderCard(row)
                    ) : (
                      <>
                        <div className="flex min-w-0 items-center gap-2">
                          {canExpand && (
                            <Button
                              variant="tertiary"
                              size="sidebar"
                              iconOnly
                              icon={
                                <DisclosureChevron
                                  expanded={isExpanded}
                                  size={14}
                                  className="shrink-0"
                                />
                              }
                              style={{ width: 14, height: 14 }}
                              className="shrink-0 hover:text-text-1"
                              onClick={(event) => {
                                event.stopPropagation();
                                event.currentTarget.blur();
                                toggleExpanded(rowKey);
                              }}
                              aria-label={
                                isExpanded
                                  ? expandLabels.collapse
                                  : expandLabels.expand
                              }
                              aria-expanded={isExpanded}
                            />
                          )}
                          <div className="min-w-0 flex-1">
                            {slots.titleColumn
                              ? renderSettingsTableCell(slots.titleColumn, row)
                              : null}
                          </div>
                          {slots.actionColumns.length > 0 && (
                            <div className="flex shrink-0 items-center gap-2">
                              {slots.actionColumns.map((column) => (
                                <React.Fragment key={column.key}>
                                  {renderSettingsTableCell(column, row)}
                                </React.Fragment>
                              ))}
                            </div>
                          )}
                        </div>
                        {slots.fieldColumns.length > 0 && (
                          <div className="flex min-w-0 flex-col gap-1.5">
                            {slots.fieldColumns.map((column) => {
                              const value = renderSettingsTableCell(
                                column,
                                row
                              );
                              if (value == null || value === false) return null;
                              if (inlineFields) {
                                return (
                                  <div
                                    key={column.key}
                                    className="flex min-w-0 items-center justify-between gap-2"
                                  >
                                    {showFieldLabels && column.label ? (
                                      <span className="shrink-0 text-xs text-text-3">
                                        {column.label}
                                      </span>
                                    ) : null}
                                    <div className="flex min-w-0 justify-end text-text-2">
                                      {value}
                                    </div>
                                  </div>
                                );
                              }
                              return (
                                <div key={column.key} className="min-w-0">
                                  {showFieldLabels && column.label ? (
                                    <div className="mb-0.5 text-xs text-text-3">
                                      {column.label}
                                    </div>
                                  ) : null}
                                  <div className="min-w-0 text-text-2">
                                    {value}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
              {expandedInRow.map((row) => {
                const rowKey = getRowKey(row);
                return (
                  <div
                    key={`${rowKey}-detail`}
                    data-testid={`${rowKey}-detail`}
                    // Bare slot: expanded content brings its own surface, the
                    // same contract the table body's detail row has. Drawing a
                    // card border here would double up on it.
                    className="settings-table-card-detail min-w-0"
                    style={{ gridColumn: "1 / -1" }}
                  >
                    <InlineSurfaceProvider surface="block">
                      {expandable
                        ? renderExpandedContent(row, rowKey, expandable)
                        : null}
                    </InlineSurfaceProvider>
                  </div>
                );
              })}
            </React.Fragment>
          );
        })}
      </div>
      {paginated && renderPagination && effectivePageSize != null && (
        <div className="flex h-10 w-full items-center border-t border-border-1 px-4">
          {renderPagination({
            pageIndex: safePageIndex,
            pageSize: effectivePageSize,
            total: rows.length,
            pageCount,
            canPreviousPage: safePageIndex > 0,
            canNextPage: safePageIndex < pageCount - 1,
            onPageChange: setPageIndex,
            onPageSizeChange: (nextPageSize) => {
              setActivePageSize(nextPageSize);
              setPageIndex(0);
            },
          })}
        </div>
      )}
    </>
  );
}

export default SettingsTableCardGrid;
