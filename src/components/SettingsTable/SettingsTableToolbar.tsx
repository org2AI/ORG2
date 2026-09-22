/**
 * SettingsTable's header toolbar: the filter selects, the reset control, the
 * list/card switch, and the search field — in one inline row, or split into a
 * search bar above a filter row.
 *
 * Extracted from `./index` so the table component itself stays within the
 * repo's file-length budget. Nothing here imports from `./index`, so the two
 * modules cannot form a cycle.
 */
import React, { type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import Select from "@src/components/Select";
import {
  DashboardSquare01Icon,
  FilterIcon,
  FilterResetIcon,
  HugeiconsIcon,
  LayoutListIcon,
} from "@src/icons";

import type { SearchSortBarProps } from "./SearchSortBar";
import { SettingsTableSearchInput } from "./SettingsTableSearchInput";
import {
  SETTINGS_TABLE_FILTER_MIN_WIDTH,
  SETTINGS_TABLE_FILTER_SEARCH_THRESHOLD,
} from "./tokens";
import type {
  SettingsTableCardViewConfig,
  SettingsTableSelectFilter,
} from "./types";

/** The toolbar's list/card switch. Shows the mode it switches *to*, matching
 *  the flat/group toggle the model table already uses. */
export function CardViewToggle<RowData>({
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

export function SettingsTableToolbar<RowData>({
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
  // An empty left column still contributes its flex gap, which pushes the
  // right column — usually just the search field — off the table's own gutter
  // and out of line with the rows below it.
  const hasLeftControls =
    !!searchBar?.leftContent ||
    (selectFilters?.length ?? 0) > 0 ||
    !!effectiveTabPills ||
    !!searchBar?.searchCountText;
  const hasRightControls =
    !!selectFiltersExtra ||
    !!filterButton ||
    !!showSort ||
    !!hasInlineSearch ||
    !!searchBar?.rightContent ||
    !!cardView?.onEnabledChange;

  return (
    <div className="flex min-w-0 flex-col gap-2 pt-2 pb-2 @[640px]:flex-row @[640px]:items-center">
      {hasLeftControls ? (
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
      ) : null}
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

export function SelectFilterRow({
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
