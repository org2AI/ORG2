/**
 * SearchEditorContent Component
 *
 * Full-tab search editor with browser URL-bar style search input.
 * Features:
 * - URL-bar style search input (centered, expands on focus)
 * - Mode selector
 * - Search options (case sensitive, whole word, regex)
 * - VS Code-style CodeMirror results with syntax highlighting
 * - Match decorations and click navigation
 * - File filters support
 *
 * This is the content rendered when a "search" tab is active in the editor.
 */
import React, { memo, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import AnyIcon from "@src/components/AnyIcon";
import Button from "@src/components/Button";
import { ToolbarTooltip } from "@src/components/KeyboardShortcut/ToolbarTooltip";
import { PLACEHOLDER_TOKENS, Placeholder } from "@src/components/Placeholder";
import { useTabViewState } from "@src/hooks/tabHost/useTabViewState";
import { usePublishWorkstationTabHeader } from "@src/hooks/tabHost/useWorkstationTabHeader";
import { FilterIcon, HugeiconsIcon, Search01Icon } from "@src/icons";

import { SearchFilters } from "../../../shared";
import SearchBar from "./SearchBar";
import SearchEditorDocument from "./SearchEditorDocument";
import { SearchHeaderActions } from "./SearchHeaderActions";
import { SearchHeaderMoreMenu } from "./SearchHeaderMoreMenu";
import { serializeSearchResults } from "./serialization";
import type { SearchEditorContentProps, SearchMode } from "./types";
import { useSearchTabContent } from "./useSearchTabContent";

// ============================================
// Empty State
// ============================================

interface EmptyStateProps {
  query: string;
  loading: boolean;
}

const EmptyState: React.FC<EmptyStateProps> = memo(({ query, loading }) => {
  const { t } = useTranslation();

  if (loading) {
    return (
      <Placeholder
        variant="loading"
        placement="detail-panel"
        title={t("status.searching")}
        fillParentHeight
      />
    );
  }

  if (!query.trim()) {
    return null;
  }

  return (
    <Placeholder
      variant="no-results"
      placement="detail-panel"
      title={t("placeholders.noMatchingResults")}
      subtitle={t("placeholders.noResultsWithFilters")}
      fillParentHeight
    />
  );
});

EmptyState.displayName = "EmptyState";

// ============================================
// Main Component
// ============================================

export const SearchEditorContent: React.FC<SearchEditorContentProps> = memo(
  ({
    sessionScopeId,
    repoPath,
    initialQuery,
    initialOptions,
    onResultClick,
    openFiles,
  }) => {
    const { t } = useTranslation();

    // Search mode + filter drawer live in the tab's view state: the content
    // is unmounted on every tab switch and rebuilt from stores on return.
    const [searchMode, setSearchMode] = useTabViewState<SearchMode>(
      sessionScopeId,
      "searchMode",
      "regex"
    );
    const [showFilters, setShowFilters] = useTabViewState(
      sessionScopeId,
      "showFilters",
      false
    );

    // Search hook - unified with sidebar search execution pipeline
    const {
      query,
      setQuery,
      options,
      setOptions,
      results,
      loading,
      error,
      refresh,
      submittedSearch,
      awaitingSubmission,
    } = useSearchTabContent({
      repoPath,
      openFiles,
      searchMode,
      sessionScopeId,
      initialQuery,
      initialOptions,
    });

    // Option toggles
    const handleCaseSensitiveToggle = useCallback(() => {
      setOptions({ caseSensitive: !options.caseSensitive });
    }, [options.caseSensitive, setOptions]);

    const handleWholeWordToggle = useCallback(() => {
      setOptions({ wholeWord: !options.wholeWord });
    }, [options.wholeWord, setOptions]);

    const handleRegexToggle = useCallback(() => {
      setOptions({ useRegex: !options.useRegex });
    }, [options.useRegex, setOptions]);

    // Filter callbacks
    const handleFilesToIncludeChange = useCallback(
      (value: string) => {
        setOptions({ filesToInclude: value });
      },
      [setOptions]
    );

    const handleFilesToExcludeChange = useCallback(
      (value: string) => {
        setOptions({ filesToExclude: value });
      },
      [setOptions]
    );

    const handleOnlyOpenFilesToggle = useCallback(() => {
      setOptions({ onlyOpenFiles: !options.onlyOpenFiles });
    }, [options.onlyOpenFiles, setOptions]);

    const handleToggleFilters = useCallback(() => {
      setShowFilters((prev) => !prev);
    }, [setShowFilters]);

    // Handle file path click (navigate to file)
    const handleFilePathClick = useCallback(
      (filePath: string, line: number) => {
        onResultClick(filePath, line);
      },
      [onResultClick]
    );

    // Serialize results for CodeMirror display
    const serializedResults = useMemo(() => {
      if (awaitingSubmission || !submittedSearch || results.length === 0)
        return null;
      return serializeSearchResults(results, {
        query: submittedSearch.query,
        mode: searchMode,
        caseSensitive: submittedSearch.options.caseSensitive,
        wholeWord: submittedSearch.options.wholeWord,
        useRegex: submittedSearch.options.useRegex,
        repoPath,
      });
    }, [results, submittedSearch, awaitingSubmission, searchMode, repoPath]);

    const headerContent = useMemo(
      () => ({
        sidebarToggleDisabled: true,
        content: (
          <SearchBar
            query={query}
            onQueryChange={setQuery}
            onSubmit={refresh}
            mode={searchMode}
            onModeChange={setSearchMode}
            isLoading={loading}
          />
        ),
        trailing: (
          <div className="flex shrink-0 items-center gap-px pl-2">
            <SearchHeaderActions
              caseSensitive={options.caseSensitive}
              wholeWord={options.wholeWord}
              useRegex={options.useRegex}
              onCaseSensitiveToggle={handleCaseSensitiveToggle}
              onWholeWordToggle={handleWholeWordToggle}
              onRegexToggle={handleRegexToggle}
            />
            <SearchHeaderMoreMenu onRefresh={refresh} loading={loading} />
          </div>
        ),
        leading: (
          <ToolbarTooltip label={t("tooltips.toggleFileFilters")}>
            <Button
              size="small"
              variant="tertiary"
              className="aria-pressed:bg-surface-selected aria-pressed:text-primary-6"
              aria-expanded={showFilters}
              aria-pressed={showFilters}
              iconOnly
              icon={<AnyIcon icon={FilterIcon} size={14} strokeWidth={2} />}
              onClick={handleToggleFilters}
              aria-label={t("tooltips.toggleFileFilters")}
            />
          </ToolbarTooltip>
        ),
      }),
      [
        query,
        setQuery,
        searchMode,
        setSearchMode,
        loading,
        options,
        handleCaseSensitiveToggle,
        handleWholeWordToggle,
        handleRegexToggle,
        showFilters,
        handleToggleFilters,
        refresh,
        t,
      ]
    );

    usePublishWorkstationTabHeader({ host: "code", content: headerContent });

    return (
      <div className="flex h-full flex-col">
        {/* File Filters (collapsible) */}
        {showFilters && (
          <div className="shrink-0">
            <SearchFilters
              filesToInclude={options.filesToInclude || ""}
              filesToExclude={options.filesToExclude || ""}
              onlyOpenFiles={options.onlyOpenFiles}
              onFilesToIncludeChange={handleFilesToIncludeChange}
              onFilesToExcludeChange={handleFilesToExcludeChange}
              onOnlyOpenFilesToggle={handleOnlyOpenFilesToggle}
              sideBySideWhenWide={true}
              showBottomBorder={!query.trim()}
              alignWithTabSearchRow={true}
            />
          </div>
        )}

        {/* Results Content - VS Code-style CodeMirror display */}
        {/* Use same container structure as CodeViewerContent */}
        <div className="relative min-h-0 flex-1">
          {awaitingSubmission ? (
            <Placeholder
              variant="empty"
              placement="detail-panel"
              fillParentHeight
              title={t("placeholders.pressEnterToSearch")}
              icon={
                <HugeiconsIcon
                  icon={Search01Icon}
                  size={PLACEHOLDER_TOKENS.detailIconSize}
                  strokeWidth={1.25}
                  className="text-text-1 opacity-30"
                />
              }
            />
          ) : error ? (
            <Placeholder
              variant="error"
              placement="detail-panel"
              title={error}
              fillParentHeight
            />
          ) : serializedResults ? (
            <SearchEditorDocument
              content={serializedResults.text}
              matchRanges={serializedResults.matchRanges}
              filePathRanges={serializedResults.filePathRanges}
              onFilePathClick={handleFilePathClick}
              loading={loading}
              readOnly={false}
            />
          ) : (
            <EmptyState query={query} loading={loading} />
          )}
        </div>
      </div>
    );
  }
);

SearchEditorContent.displayName = "SearchEditorContent";

export default SearchEditorContent;
