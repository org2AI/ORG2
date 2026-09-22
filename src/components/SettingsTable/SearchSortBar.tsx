/** SettingsTable-owned search, sort, and filter toolbar. */
import React from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import type { InputProps } from "@src/components/Input";
import Select from "@src/components/Select";
import type { SelectOption } from "@src/components/Select";
import { FilterIcon, HugeiconsIcon } from "@src/icons";

import {
  SettingsTableSearchInput,
  type SettingsTableSearchShortcut,
} from "./SettingsTableSearchInput";

export interface SearchSortBarFilterConfig {
  pills: React.ReactNode;
  expanded: boolean;
  active: boolean;
  onToggle: () => void;
  title?: string;
}

export interface SearchSortBarProps {
  searchValue?: string;
  searchPlaceholder?: string;
  searchInputSize?: InputProps["size"];
  onSearchChange?: (value: string) => void;
  onSearchClear?: () => void;
  sortValue?: string;
  sortOptions?: SelectOption[];
  onSortChange?: (value: string | number | (string | number)[]) => void;
  searchCountText?: string;
  sortWidthClassName?: string;
  leftContent?: React.ReactNode;
  rightContent?: React.ReactNode;
  /** Rendered immediately before {@link rightContent}. SettingsTable uses it
   *  for controls it owns (the card-view toggle) so a consumer's own
   *  `rightContent` stays untouched. */
  leadingRightContent?: React.ReactNode;
  allowSearchClear?: boolean;
  /** ⌘F / Ctrl+F focuses this field and shows its key hint. On by default;
   *  pass `false` to opt out, or an object to change the binding. */
  searchShortcut?: SettingsTableSearchShortcut;
  /** Tab pills rendered inline with searchCountText (pills left, count right) */
  tabPills?: React.ReactNode;
  /** Filter button + collapsible pills. When provided, renders Filter button and pills when expanded. */
  filterConfig?: SearchSortBarFilterConfig;
  /** Strip horizontal padding (for consumers that provide their own outer px) */
  noPadding?: boolean;
}

const SearchSortBar: React.FC<SearchSortBarProps> = ({
  searchValue,
  searchPlaceholder,
  searchInputSize,
  onSearchChange,
  onSearchClear,
  sortValue,
  sortOptions,
  onSortChange,
  searchCountText,
  sortWidthClassName = "w-[180px]",
  leftContent,
  rightContent,
  leadingRightContent,
  allowSearchClear = true,
  searchShortcut,
  tabPills,
  filterConfig,
  noPadding = false,
}) => {
  const { t } = useTranslation();
  const showSort =
    typeof sortValue === "string" &&
    Array.isArray(sortOptions) &&
    sortOptions.length > 0 &&
    typeof onSortChange === "function";

  const hasSearchInput =
    searchValue !== undefined &&
    searchPlaceholder !== undefined &&
    typeof onSearchChange === "function";

  const consumerRightContent =
    rightContent ??
    (filterConfig ? (
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
    ) : undefined);

  const effectiveRightContent =
    leadingRightContent || consumerRightContent ? (
      <div className="flex shrink-0 items-center gap-1.5">
        {leadingRightContent}
        {consumerRightContent}
      </div>
    ) : undefined;

  const effectiveTabPills = filterConfig?.expanded
    ? filterConfig.pills
    : tabPills;

  const showTopRow =
    hasSearchInput || !!leftContent || !!effectiveRightContent || showSort;
  const tabPillsRowClassName = `scrollbar-hide min-w-0 shrink-0 overflow-x-auto overflow-y-hidden pb-2 ${showTopRow ? "" : "pt-2"} ${noPadding ? "" : "px-4"}`;

  return (
    <>
      {showTopRow && (
        <div className={`shrink-0 pt-2 pb-2 ${noPadding ? "" : "px-4"}`}>
          <div className="flex items-center gap-1.5">
            {leftContent}
            {hasSearchInput && (
              <div className="min-w-0 flex-1">
                <SettingsTableSearchInput
                  size={searchInputSize}
                  value={searchValue}
                  placeholder={searchPlaceholder}
                  onChange={onSearchChange}
                  allowClear={allowSearchClear}
                  onClear={onSearchClear}
                  shortcut={searchShortcut}
                />
              </div>
            )}
            {effectiveRightContent}
            {!rightContent && showSort && (
              <div className={sortWidthClassName}>
                <Select
                  value={sortValue}
                  onChange={onSortChange}
                  options={sortOptions}
                />
              </div>
            )}
          </div>
        </div>
      )}
      {(searchCountText || effectiveTabPills) && (
        <div className={tabPillsRowClassName}>
          <div className="flex w-max min-w-full items-center gap-2">
            {effectiveTabPills && (
              <div className="min-w-0 shrink-0">{effectiveTabPills}</div>
            )}
            {searchCountText && (
              <span className="shrink-0 pl-2 text-[13px] font-semibold text-text-1">
                {searchCountText}
              </span>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default SearchSortBar;
