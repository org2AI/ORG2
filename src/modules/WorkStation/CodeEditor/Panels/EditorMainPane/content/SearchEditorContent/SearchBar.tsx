/**
 * SearchBar Component
 *
 * Shared-styled search controls for the search editor tab.
 * Uses the same reusable input/select components as other tabs.
 */
import React, { memo } from "react";
import { useTranslation } from "react-i18next";

import { SPINNER_TOKENS } from "@src/config/spinnerTokens";
import { HugeiconsIcon, Loading03Icon } from "@src/icons";

import { SearchInput, SearchModeSelect } from "../../../shared";
import { SEARCH_MODE_OPTIONS } from "../../../shared/SearchModeSelect";
import type { SearchBarProps } from "./types";

export const SearchBar: React.FC<SearchBarProps> = memo(
  ({
    query,
    onQueryChange,
    onSubmit,
    mode,
    onModeChange,
    isLoading = false,
    className = "",
  }) => {
    const { t } = useTranslation();

    return (
      <div
        className={`flex h-full min-w-0 flex-1 items-center gap-1.5 ${className}`}
        data-tauri-drag-region="false"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        {/* Show the mode picker only when there is a choice to make. */}
        {SEARCH_MODE_OPTIONS.length > 1 && (
          <SearchModeSelect
            value={mode}
            onChange={onModeChange}
            disabled={isLoading}
            size="small"
            appearance="ghost"
            className="w-36 shrink-0"
          />
        )}

        <SearchInput
          value={query}
          onChange={onQueryChange}
          onSubmit={onSubmit}
          placeholder={t("placeholders.searchInRepository")}
          variant="panel"
          surface="ghost"
          ariaLabel={t("placeholders.searchInRepository")}
          hideChevron={true}
          showClearButton
          className="min-w-0 flex-1"
        />

        {isLoading && (
          <HugeiconsIcon
            icon={Loading03Icon}
            data-icon="loader-2"
            size={SPINNER_TOKENS.default}
            className="animate-spin text-text-3"
          />
        )}
      </div>
    );
  }
);

SearchBar.displayName = "SearchBar";

export default SearchBar;
