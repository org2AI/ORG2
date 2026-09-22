import React, { type ReactNode, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import { Placeholder } from "@src/components/Placeholder";
import Select from "@src/components/Select";
import Table, { type TableColumn } from "@src/components/Table";
import { useElementDimensions } from "@src/hooks/ui/layout/useElementDimensions";
import {
  DashboardSquare01Icon,
  FilterIcon,
  FilterResetIcon,
  HugeiconsIcon,
  LayoutListIcon,
} from "@src/icons";

import SearchSortBar, { type SearchSortBarProps } from "./SearchSortBar";
import { SettingsTableAddFooter } from "./SettingsTableAddFooter";
import type { SettingsTableAddFooterProps } from "./SettingsTableAddFooter";
import { SettingsTableCardGrid } from "./SettingsTableCardGrid";
import { SettingsTablePagination } from "./SettingsTablePagination";
import { SettingsTableSearchInput } from "./SettingsTableSearchInput";
import { renderSettingsTableCell } from "./renderSettingsTableCell";
import {
  SETTINGS_TABLE_FILTER_MIN_WIDTH,
  SETTINGS_TABLE_FILTER_SEARCH_THRESHOLD,
} from "./tokens";
import type {
  SettingsTableBodySurface,
  SettingsTableCardViewConfig,
  SettingsTableColumn,
  SettingsTablePaginationContext,
  SettingsTableSelectFilter,
  SettingsTableSurfaceVariant,
} from "./types";

export {
  SETTINGS_TABLE_CELL,
  SETTINGS_TABLE_COL,
  SETTINGS_TABLE_FILTER_MIN_WIDTH,
  SETTINGS_TABLE_FILTER_SEARCH_THRESHOLD,
} from "./tokens";
export { renderAllFilterIcon } from "./filterIcons";
export type { SettingsTableSearchShortcut } from "./SettingsTableSearchInput";
export type {
  SettingsTableBodySurface,
  SettingsTableCardViewConfig,
  SettingsTableColumn,
  SettingsTablePaginationContext,
  SettingsTableSelectFilter,
  SettingsTableSurfaceVariant,
} from "./types";

export interface SettingsTableProps<RowData> {
  columns: SettingsTableColumn<RowData>[];
  rows: RowData[];
  getRowKey: (rowData: RowData) => string;
  /** Header height: "compact" (32px, default) for nested tables, "tall" (40px) for standalone */
  headerHeight?: "compact" | "tall";
  /** When false, hides the column header row. Default: true */
  showHeader?: boolean;
  /** Vertical alignment for header and body cells. Default: middle. */
  cellVerticalAlign?: "middle" | "top";
  /** Reduce row padding for cells containing 32px form controls (Input/Button) */
  dense?: boolean;
  /** When set, enables client-side pagination with the given page size */
  pageSize?: number;
  /** Page size options for the size-changer Select. Default: [10, 20, 50, 100] */
  pageSizeOptions?: number[];
  /** Custom pagination footer. When provided, replaces the default footer. */
  paginationFooter?: (ctx: SettingsTablePaginationContext) => React.ReactNode;
  /** Expandable row config — renders detail content below a row when toggled.
   *  Return ReactNode for free-form content, or ReactNode[][] for column-aligned sub-rows. */
  expandable?: {
    expandedRowRender?: (
      record: RowData
    ) => React.ReactNode | React.ReactNode[][];
    rowExpandable?: (record: RowData) => boolean;
    expandedRowKeys?: string[];
    onExpandedRowsChange?: (keys: string[]) => void;
    onSubRowClick?: (parentRecord: RowData, subRowIndex: number) => void;
  };
  /** Body-only loading state; keeps header, toolbar, columns, and footer visible. */
  loading?: boolean;
  /** Custom title for the empty state Placeholder. */
  emptyTitle?: string;
  /** Custom subtitle for the empty state Placeholder. */
  emptySubtitle?: string;
  /** Action button shown below the empty state (e.g. Add). */
  emptyAction?: {
    label: string;
    onClick: () => void;
    type?: "primary" | "secondary";
  };
  /** Empty state shown while loading is false. Useful to suppress premature empty placeholders during first load. */
  noDataElement?: React.ReactNode;
  /** Footer rendered below the table (e.g. "+ Add" button). */
  footer?: React.ReactNode;
  /** Shorthand for a standard "+ Add" footer button. Ignored when `footer` is provided. */
  addFooter?: SettingsTableAddFooterProps;
  /** Sticky search bar rendered above the table header. Both stick together when scrolling. */
  searchBar?: SearchSortBarProps;
  /** Extra classes for the sticky search/header wrapper. */
  searchHeaderClassName?: string;
  /** Select filter row rendered below the search bar. Each entry uses the regular 32px Select size. */
  selectFilters?: SettingsTableSelectFilter[];
  /** Extra inline content rendered at the end of the {@link selectFilters} row
   *  (e.g. a scope TabPill). Renders only when this prop or `selectFilters`
   *  has content. */
  selectFiltersExtra?: ReactNode;
  /** When true, filters/pills and search share one 32px row when space allows, then split into search/actions above filters. Default: false. */
  inlineHeaderToolbar?: boolean;
  /** When false, disables sticky table header. Default: true */
  stickyHeader?: boolean;
  /** When true, pins the first (label) column while scrolling horizontally. */
  stickyFirstColumn?: boolean;
  /** When true, shows a border below the header row. Default: false */
  headerBorder?: boolean;
  /** When true, removes horizontal cell padding on outer edges (first-child left, last-child right).
   *  Use for tables nested inside SectionContainer which already provides px-4. */
  noPx?: boolean;
  /** Row click handler. Non-interactive row clicks also toggle expandable rows; buttons, links, and inputs are ignored. */
  onRowClick?: (row: RowData) => void;
  /** Enable row hover highlight. Default: false */
  hover?: boolean;
  /** Optional class or function for row styling (e.g. selected highlight) */
  rowClassName?: string | ((row: RowData, index: number) => string);
  rowDataTestId?: (row: RowData, index: number) => string | undefined;
  rowDataAttributes?: (
    row: RowData,
    index: number
  ) => Record<string, string | number | boolean | undefined> | undefined;
  surfaceVariant?: SettingsTableSurfaceVariant;
  /** Body surface treatment. "raised" (default) keeps the title row and rows
   *  on the raised table surface; "pane" blends them into the surrounding
   *  page/chat pane — the exception used by the GitHub PR/issue and
   *  work-item tables. */
  bodySurface?: SettingsTableBodySurface;
  /** Fill the parent flex column and scroll rows inside the table body. */
  fillHeight?: boolean;
  /** Cap table height and scroll rows inside the body. */
  maxHeight?: number | string;
  /** Render rows as cards instead of table rows while `cardView.enabled` is
   *  true. The toolbar, filters, expandable rows, footer, and pagination are
   *  unchanged; column header sorting has no card equivalent. */
  cardView?: SettingsTableCardViewConfig<RowData>;
  className?: string;
  rootClassName?: string;
}

/** The toolbar's list/card switch. Shows the mode it switches *to*, matching
 *  the flat/group toggle the model table already uses. */
function CardViewToggle<RowData>({
  cardView,
}: {
  cardView?: SettingsTableCardViewConfig<RowData>;
}) {
  const { t } = useTranslation();
  if (!cardView?.onEnabledChange) return null;

  const showingCards = cardView.enabled;
  const label = showingCards ? t("actions.listView") : t("actions.cardView");
  return (
    <Button
      iconOnly
      onClick={() => cardView.onEnabledChange?.(!showingCards)}
      icon={
        <HugeiconsIcon
          icon={showingCards ? LayoutListIcon : DashboardSquare01Icon}
          data-icon={showingCards ? "layout-list" : "dashboard-square"}
          size={14}
        />
      }
      aria-label={label}
      title={label}
      data-testid="settings-table-view-toggle"
    />
  );
}

/** Long option lists get a search box; short fixed ones read faster without. */
function filterIsSearchable(filter: SettingsTableSelectFilter): boolean {
  return (
    filter.searchable ??
    filter.options.length > SETTINGS_TABLE_FILTER_SEARCH_THRESHOLD
  );
}

/** A filter is "on" whenever it sits anywhere but its own unfiltered value. */
function hasActiveFilters(filters?: SettingsTableSelectFilter[]): boolean {
  return (filters ?? []).some((filter) => filter.value !== filter.defaultValue);
}

/** Sends every filter back to its `defaultValue` in one pass. */
function resetFilters(filters?: SettingsTableSelectFilter[]): void {
  for (const filter of filters ?? []) {
    if (filter.value !== filter.defaultValue)
      filter.onChange(filter.defaultValue);
  }
}

function ResetFiltersButton({
  filters,
  label,
}: {
  filters?: SettingsTableSelectFilter[];
  label: string;
}) {
  if (!hasActiveFilters(filters)) return null;
  return (
    <Button
      iconOnly
      variant="tertiary"
      onClick={() => resetFilters(filters)}
      icon={
        <HugeiconsIcon
          icon={FilterResetIcon}
          data-icon="filter-reset"
          size={14}
        />
      }
      aria-label={label}
      title={label}
      className="shrink-0 text-text-3 hover:text-text-1"
      data-testid="settings-table-reset-filters"
    />
  );
}

function SettingsTableToolbar<RowData>({
  searchBar,
  selectFilters,
  selectFiltersExtra,
  cardView,
}: {
  searchBar?: SearchSortBarProps;
  selectFilters?: SettingsTableSelectFilter[];
  selectFiltersExtra?: ReactNode;
  cardView?: SettingsTableCardViewConfig<RowData>;
}) {
  const { t } = useTranslation();

  const effectiveTabPills = searchBar?.filterConfig?.expanded
    ? searchBar.filterConfig.pills
    : searchBar?.tabPills;

  const filterConfig = searchBar?.filterConfig;
  const showSort =
    searchBar &&
    typeof searchBar.sortValue === "string" &&
    Array.isArray(searchBar.sortOptions) &&
    searchBar.sortOptions.length > 0 &&
    typeof searchBar.onSortChange === "function";

  const hasInlineSearch =
    searchBar?.onSearchChange != null &&
    searchBar.searchPlaceholder != null &&
    searchBar.searchValue !== undefined;

  const filterButton = filterConfig ? (
    <Button
      iconOnly
      onClick={filterConfig.onToggle}
      icon={
        <HugeiconsIcon
          icon={FilterIcon}
          data-icon="filter"
          size={14}
          className={filterConfig.active ? "text-primary-6" : ""}
        />
      }
      title={filterConfig.title ?? t("actions.filter")}
    />
  ) : undefined;
  const hasRightControls =
    !!selectFiltersExtra ||
    !!filterButton ||
    !!showSort ||
    !!hasInlineSearch ||
    !!searchBar?.rightContent ||
    !!cardView?.onEnabledChange;

  return (
    <div className="flex min-w-0 flex-col gap-2 pt-2 pb-2 @[640px]:flex-row @[640px]:items-center">
      <div className="order-2 scrollbar-hide w-full min-w-0 overflow-x-auto overflow-y-hidden @[640px]:order-1 @[640px]:w-auto @[640px]:flex-none">
        <div className="flex w-max min-w-full items-center gap-2">
          {searchBar?.leftContent}
          {selectFilters?.map((filter) => {
            const isActive = filter.value !== filter.defaultValue;
            return (
              <Select
                key={filter.key}
                value={filter.value}
                options={filter.options}
                onChange={(val) => filter.onChange(val as string | number)}
                appearance={filter.appearance ?? "ghost"}
                dropdownWidthMode="auto"
                dropdownMinWidth={
                  filter.minWidth ?? SETTINGS_TABLE_FILTER_MIN_WIDTH
                }
                showSearch={filterIsSearchable(filter)}
                // Option marks belong to the dropdown rows; the closed trigger
                // stays a plain label so the toolbar reads as one row of text.
                showTriggerIcon={false}
                className={isActive ? "text-primary-6" : ""}
              />
            );
          })}
          <ResetFiltersButton
            filters={selectFilters}
            label={t("actions.resetFilters")}
          />
          {effectiveTabPills ? (
            <div className="flex min-w-0 shrink-0 items-center gap-2">
              {effectiveTabPills}
            </div>
          ) : null}
          {searchBar?.searchCountText ? (
            <span className="text-[13px] font-semibold text-text-1">
              {searchBar.searchCountText}
            </span>
          ) : null}
        </div>
      </div>
      {hasRightControls ? (
        <div className="order-1 flex w-full min-w-0 items-center justify-end gap-2 @[640px]:order-2 @[640px]:flex-1">
          {selectFiltersExtra ? (
            <div className="flex shrink-0 items-center">
              {selectFiltersExtra}
            </div>
          ) : null}
          {filterButton}
          {showSort && searchBar ? (
            <div className={searchBar.sortWidthClassName ?? "w-[180px]"}>
              <Select
                value={searchBar.sortValue}
                onChange={searchBar.onSortChange}
                options={searchBar.sortOptions}
              />
            </div>
          ) : null}
          {hasInlineSearch && searchBar ? (
            <div className="min-w-0 flex-1">
              <SettingsTableSearchInput
                size={searchBar.searchInputSize ?? "default"}
                value={searchBar.searchValue ?? ""}
                placeholder={searchBar.searchPlaceholder}
                onChange={(value) => searchBar.onSearchChange?.(value)}
                allowClear={searchBar.allowSearchClear ?? true}
                onClear={searchBar.onSearchClear}
                shortcut={searchBar.searchShortcut}
              />
            </div>
          ) : null}
          <CardViewToggle cardView={cardView} />
          {searchBar?.rightContent ? (
            <div className="flex shrink-0 items-center gap-2">
              {searchBar.rightContent}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SelectFilterRow({
  filters,
  extra,
  hasSearchBarAbove,
  resetLabel,
  trailing,
}: {
  filters: SettingsTableSelectFilter[];
  extra?: ReactNode;
  hasSearchBarAbove: boolean;
  resetLabel: string;
  trailing?: ReactNode;
}) {
  return (
    <div
      className={`scrollbar-hide min-w-0 overflow-x-auto overflow-y-hidden px-1 pb-1 ${hasSearchBarAbove ? "" : "pt-1"}`}
    >
      <div className="flex w-max min-w-full items-center gap-2">
        {filters.map((filter) => {
          const isActive = filter.value !== filter.defaultValue;
          return (
            <Select
              key={filter.key}
              value={filter.value}
              options={filter.options}
              onChange={(val) => filter.onChange(val as string | number)}
              appearance={filter.appearance ?? "ghost"}
              dropdownWidthMode="auto"
              dropdownMinWidth={
                filter.minWidth ?? SETTINGS_TABLE_FILTER_MIN_WIDTH
              }
              showSearch={filterIsSearchable(filter)}
              showTriggerIcon={false}
              className={isActive ? "text-primary-6" : ""}
            />
          );
        })}
        <ResetFiltersButton filters={filters} label={resetLabel} />
        {extra ? (
          <div className="flex shrink-0 items-center">{extra}</div>
        ) : null}
        {trailing ? (
          <div className="ml-auto flex shrink-0 items-center pl-2">
            {trailing}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function SettingsTable<RowData>({
  columns,
  rows,
  getRowKey,
  headerHeight = "compact",
  showHeader = true,
  cellVerticalAlign = "middle",
  dense = false,
  pageSize,
  pageSizeOptions,
  paginationFooter,
  expandable,
  loading = false,
  emptyTitle,
  emptySubtitle,
  emptyAction,
  noDataElement,
  footer,
  addFooter,
  searchBar,
  searchHeaderClassName = "",
  selectFilters,
  selectFiltersExtra,
  inlineHeaderToolbar = false,
  stickyHeader = true,
  stickyFirstColumn = false,
  headerBorder = false,
  noPx = false,
  onRowClick,
  hover = false,
  rowClassName,
  rowDataTestId,
  rowDataAttributes,
  surfaceVariant = "default",
  bodySurface = "raised",
  fillHeight = false,
  maxHeight,
  cardView,
  className = "",
  rootClassName = "",
}: SettingsTableProps<RowData>) {
  const { t } = useTranslation();
  const searchRef = useRef<HTMLDivElement>(null);
  const hasSelectFilterRow =
    (!!selectFilters && selectFilters.length > 0) || !!selectFiltersExtra;
  const hasViewToggle = !!cardView?.onEnabledChange;
  const hasSearchBar = !!searchBar || hasSelectFilterRow || hasViewToggle;
  const searchHeight = useElementDimensions(searchRef, {
    dimension: "height",
    deps: [hasSearchBar],
  });

  const resolvedFooter =
    footer ??
    (addFooter ? (
      <SettingsTableAddFooter {...addFooter} noPx={addFooter.noPx ?? noPx} />
    ) : null);
  const tableColumns = useMemo<TableColumn<RowData>[]>(
    () =>
      columns.map((column) => ({
        key: column.key,
        dataIndex: column.key,
        title: column.label,
        width: column.width,
        align: column.align,
        sorter: column.sorter,
        render: (_value, rowData) => renderSettingsTableCell(column, rowData),
      })),
    [columns]
  );

  const cardMode = cardView?.enabled === true;
  const needsPagination = pageSize != null && rows.length > pageSize;
  const showEmptyFooter = !needsPagination && resolvedFooter == null;
  const hasBottomFooter =
    needsPagination || resolvedFooter != null || showEmptyFooter;
  const containedScroll = fillHeight || maxHeight != null;
  const heightClass = headerHeight === "tall" ? "table-settings-tall" : "";
  const denseClass = dense ? "table-settings-dense" : "";
  const noStickyClass = !stickyHeader ? "table-settings-no-sticky" : "";
  const headerBorderClass = headerBorder ? "table-settings-header-border" : "";
  const noHeaderClass = !showHeader ? "table-settings-no-header" : "";
  const noPxClass = noPx ? "table-settings-no-px" : "";
  const cellVAlignClass =
    cellVerticalAlign === "top" ? "table-settings-cell-top" : "";
  const combinedClassName = [
    heightClass,
    denseClass,
    noStickyClass,
    headerBorderClass,
    noHeaderClass,
    noPxClass,
    cellVAlignClass,
    fillHeight && "table-settings-fill-height",
    maxHeight != null && "table-settings-fill-height",
    containedScroll && "table-settings-contained-scroll",
    stickyFirstColumn && "table-settings-sticky-first-col",
    bodySurface === "pane" && "table-settings-pane-body",
    !hasSearchBar &&
      surfaceVariant !== "transparent" &&
      "table-settings-rounded-top",
    !hasBottomFooter && "table-settings-no-footer",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const emptyElement = noDataElement ?? (
    <Placeholder
      variant="empty"
      title={emptyTitle}
      subtitle={emptySubtitle}
      action={emptyAction}
    />
  );

  const paginationRenderer = useMemo(() => {
    if (!needsPagination) return undefined;
    if (paginationFooter) return paginationFooter;
    return function SettingsTablePaginationRenderer(
      ctx: SettingsTablePaginationContext
    ) {
      return (
        <SettingsTablePagination {...ctx} pageSizeOptions={pageSizeOptions} />
      );
    };
  }, [needsPagination, paginationFooter, pageSizeOptions]);

  const hasHeader = !!searchBar || hasSelectFilterRow || hasViewToggle;
  const surfaceClassName =
    surfaceVariant === "transparent"
      ? "settings-table-root-transparent"
      : "settings-table-root-default bg-primary-container";
  // Standalone tables get an outer border. Tables flagged `noPx` are embedded
  // inside a SectionContainer that already draws the border — skip it there to
  // avoid a double border.
  const hasOuterBorder = surfaceVariant !== "transparent" && !noPx;
  // Page-scrolled tables with a sticky header: the header must carry the top
  // border + radius itself so they stay pinned while scrolling (the root scrolls
  // away). The header's side borders are pulled out by 1px (-mx-px) so they sit
  // exactly on top of the root's side borders — otherwise the two 12px arcs land
  // 1px apart and the corner renders a doubled/offset curve.
  // Contained-scroll tables (fillHeight/maxHeight) clip via overflow-hidden, so
  // the root can keep the full border with clean corners — no split needed.
  const stickyBordered = hasOuterBorder && hasHeader && !containedScroll;
  const rootClasses = [
    "settings-table-root min-w-0 max-w-full",
    surfaceVariant !== "transparent" && "rounded-xl",
    hasOuterBorder &&
      (stickyBordered
        ? "border-x border-b border-border-1"
        : "border border-border-1"),
    fillHeight && "flex h-full min-h-0 flex-col overflow-hidden",
    maxHeight != null && "flex min-h-0 flex-col overflow-hidden",
    surfaceClassName,
    rootClassName,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={rootClasses}
      style={{
        ...(hasHeader && !containedScroll
          ? ({ "--search-bar-h": `${searchHeight}px` } as React.CSSProperties)
          : {}),
        ...(maxHeight != null ? { maxHeight } : {}),
      }}
    >
      {hasHeader && (
        <div
          ref={searchRef}
          className={`${containedScroll ? "shrink-0" : "settings-table-sticky-toolbar"} ${stickyBordered ? "settings-table-sticky-mask bg-bg-2" : ""}`.trim()}
        >
          <div
            className={`${stickyBordered ? "settings-table-sticky-surface -mx-px border-x border-t border-border-1" : ""} border-b border-border-1 px-4 ${surfaceVariant !== "transparent" ? "rounded-t-xl" : ""} ${surfaceClassName} ${searchHeaderClassName}`.trim()}
          >
            {inlineHeaderToolbar ? (
              <SettingsTableToolbar<RowData>
                searchBar={searchBar}
                selectFilters={selectFilters}
                selectFiltersExtra={selectFiltersExtra}
                cardView={cardView}
              />
            ) : (
              <>
                {searchBar && (
                  <SearchSortBar
                    {...searchBar}
                    noPadding
                    leadingRightContent={<CardViewToggle cardView={cardView} />}
                  />
                )}
                {!searchBar && !hasSelectFilterRow && hasViewToggle && (
                  <div className="flex justify-end py-2">
                    <CardViewToggle cardView={cardView} />
                  </div>
                )}
                {hasSelectFilterRow && (
                  <SelectFilterRow
                    filters={selectFilters ?? []}
                    extra={selectFiltersExtra}
                    hasSearchBarAbove={!!searchBar}
                    resetLabel={t("actions.resetFilters")}
                    // Without a search bar the filter row is the only toolbar
                    // the table has, so the view toggle lands there instead.
                    trailing={
                      searchBar ? undefined : (
                        <CardViewToggle cardView={cardView} />
                      )
                    }
                  />
                )}
              </>
            )}
          </div>
        </div>
      )}
      {cardMode && cardView ? (
        <SettingsTableCardGrid<RowData>
          cardView={cardView}
          columns={columns}
          rows={rows}
          getRowKey={getRowKey}
          loading={loading}
          noDataElement={emptyElement}
          expandable={expandable}
          onRowClick={onRowClick}
          rowDataTestId={rowDataTestId}
          rowDataAttributes={rowDataAttributes}
          pageSize={pageSize}
          renderPagination={paginationRenderer}
          expandLabels={{
            expand: t("actions.expand"),
            collapse: t("actions.collapse"),
          }}
        />
      ) : (
        <Table<RowData>
          columns={tableColumns}
          data={rows}
          rowKey={getRowKey}
          showHeader={showHeader}
          pagination={needsPagination ? { pageSize } : false}
          renderPagination={paginationRenderer}
          hover={hover}
          stripe={false}
          border={false}
          settings
          size="small"
          className={combinedClassName}
          loading={loading}
          expandable={expandable}
          onRowClick={
            onRowClick ? (record: RowData) => onRowClick(record) : undefined
          }
          rowClassName={rowClassName}
          rowDataTestId={rowDataTestId}
          rowDataAttributes={rowDataAttributes}
          noDataElement={emptyElement}
        />
      )}
      {resolvedFooter}
      {showEmptyFooter && (
        <div
          className={`settings-table-empty-footer ${bodySurface === "pane" ? "settings-table-empty-footer-pane" : ""}`.trim()}
        />
      )}
    </div>
  );
}
export { SettingsTableLoadMoreFooter } from "./SettingsTableLoadMoreFooter";
export { SettingsTablePagination } from "./SettingsTablePagination";
