/**
 * SearchFilters Component
 *
 * VSCode-style search filters for include/exclude patterns.
 * Uses searchControlSingleLineInputStyle so line-height matches row height.
 */
import React, { memo } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import Input from "@src/components/Input";
import {
  SEARCH_WRAPPER_SIDEBAR,
  searchControlSingleLineInputStyle,
} from "@src/components/SearchInput/searchControlInputStyles";
import { BookOpen01Icon, HugeiconsIcon } from "@src/icons";

// ============================================
// Types
// ============================================

export interface SearchFiltersProps {
  /** Files to include pattern */
  filesToInclude: string;
  /** Files to exclude pattern */
  filesToExclude: string;
  /** Only search in open files */
  onlyOpenFiles?: boolean;
  /** onChange handlers */
  onFilesToIncludeChange: (value: string) => void;
  onFilesToExcludeChange: (value: string) => void;
  /** Toggle only open files */
  onOnlyOpenFilesToggle?: () => void;
  /** Auto switch to side-by-side layout when width allows */
  sideBySideWhenWide?: boolean;
  /** Show bottom divider */
  showBottomBorder?: boolean;
  /** Align container padding with tab search row (px-3) */
  alignWithTabSearchRow?: boolean;
}

// ============================================
// Main Component
// ============================================

export const SearchFilters: React.FC<SearchFiltersProps> = memo(
  ({
    filesToInclude,
    filesToExclude,
    onlyOpenFiles = false,
    onFilesToIncludeChange,
    onFilesToExcludeChange,
    onOnlyOpenFilesToggle,
    sideBySideWhenWide = false,
    showBottomBorder = true,
    alignWithTabSearchRow = false,
  }) => {
    const { t } = useTranslation();

    const containerClass = [
      alignWithTabSearchRow ? "px-3 py-2" : "py-2 pl-[34px] pr-3",
      showBottomBorder ? "border-b border-border-2" : "",
      sideBySideWhenWide ? "flex flex-wrap gap-3" : "space-y-2",
    ]
      .filter(Boolean)
      .join(" ");

    const sectionClass = sideBySideWhenWide ? "min-w-[280px] flex-1" : "";

    const filterWrapperClass = SEARCH_WRAPPER_SIDEBAR;

    return (
      <div className={containerClass}>
        {/* Files to include with BookOpen icon */}
        <div className={sectionClass}>
          <label
            htmlFor="files-to-include"
            className="mb-1 block text-[11px] font-medium text-text-3"
          >
            {t("labels.filesToInclude")}
          </label>
          <div className={filterWrapperClass}>
            <Input
              autoHeight
              appearance="bare"
              size="small"
              id="files-to-include"
              type="text"
              value={filesToInclude}
              onChange={(value) => onFilesToIncludeChange(value)}
              placeholder={t("placeholders.includeExample")}
              inputStyle={searchControlSingleLineInputStyle(13)}
              className="min-w-0 flex-1 [&>.input-inner]:border-0!"
              inputClassName="text-text-1 placeholder:text-text-3"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
            />
            {onOnlyOpenFilesToggle && (
              <Button
                variant="tertiary"
                size="sidebar"
                aria-pressed={onlyOpenFiles}
                aria-label={t("tooltips.searchInOpenEditors")}
                iconOnly
                icon={
                  <HugeiconsIcon
                    icon={BookOpen01Icon}
                    data-icon="book-open"
                    size={14}
                  />
                }
                onClick={onOnlyOpenFilesToggle}
                className={`shrink-0 self-center ${onlyOpenFiles ? "text-primary-6" : ""}`}
                title={t("tooltips.searchInOpenEditors")}
              />
            )}
          </div>
        </div>

        {/* Files to exclude */}
        <div className={sectionClass}>
          <label
            htmlFor="files-to-exclude"
            className="mb-1 block text-[11px] font-medium text-text-3"
          >
            {t("labels.filesToExclude")}
          </label>
          <div className={filterWrapperClass}>
            <Input
              autoHeight
              appearance="bare"
              size="small"
              id="files-to-exclude"
              type="text"
              value={filesToExclude}
              onChange={(value) => onFilesToExcludeChange(value)}
              placeholder={t("placeholders.excludeExample")}
              inputStyle={searchControlSingleLineInputStyle(13)}
              className="min-w-0 flex-1 [&>.input-inner]:border-0!"
              inputClassName="text-text-1 placeholder:text-text-3"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
            />
          </div>
          <p className="mt-0.5 text-[10px] text-text-2">
            {t("labels.globPatternsHint")}
          </p>
        </div>
      </div>
    );
  }
);

SearchFilters.displayName = "SearchFilters";

export default SearchFilters;
