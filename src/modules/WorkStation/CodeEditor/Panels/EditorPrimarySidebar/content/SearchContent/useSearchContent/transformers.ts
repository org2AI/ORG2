/**
 * Search Result Transformers
 *
 * Pure functions for transforming search backend results
 * to the store/UI format used by the search panel.
 */
import type {
  SearchOptions as StoreSearchOptions,
  SearchResultFile as StoreSearchResultFile,
} from "@src/store/workstation/codeEditor/search";

import { SEARCH_CONSTANTS } from "../config";
import type { SearchOptions, SearchResultFile } from "../types";

/**
 * Convert store result format to UI format
 */
export function toUIResult(result: StoreSearchResultFile): SearchResultFile {
  return {
    file_path: result.file_path,
    matches: result.matches.map((match) => ({
      line: match.line,
      column: match.column,
      end_line: match.end_line,
      end_column: match.end_column,
      text: match.text,
      context_before: match.context_before,
      context_after: match.context_after,
    })),
  };
}

/**
 * Convert store options to UI options
 */
export function toUIOptions(opts: StoreSearchOptions): SearchOptions {
  return {
    caseSensitive: opts.caseSensitive,
    wholeWord: opts.wholeWord,
    useRegex: opts.useRegex,
    fileExtensions: opts.fileExtensions,
    excludeDirs: opts.excludeDirs,
    maxResults: SEARCH_CONSTANTS.MAX_TOTAL_RESULTS,
    offset: 0,
    filesToInclude: opts.filesToInclude,
    filesToExclude: opts.filesToExclude,
    onlyOpenFiles: opts.onlyOpenFiles,
  };
}

// ============================================
// Utility Functions
// ============================================

/**
 * Parse comma-separated file patterns from options string.
 */
export function parseFilePatterns(patternsString?: string): string[] {
  return (
    patternsString
      ?.split(",")
      .map((pattern) => pattern.trim())
      .filter(Boolean) || []
  );
}

/**
 * Build search filter options for the Rust backend.
 */
export function buildSearchFilters(
  storeOptions: StoreSearchOptions,
  includePatterns: string[],
  excludePatterns: string[]
) {
  return {
    case_sensitive: storeOptions.caseSensitive,
    whole_word: storeOptions.wholeWord,
    use_regex: storeOptions.useRegex,
    file_extensions:
      includePatterns.length === 0 && storeOptions.fileExtensions.length > 0
        ? storeOptions.fileExtensions
        : undefined,
    include_globs: includePatterns.length
      ? includePatterns.map((pattern) =>
          /^\.[a-zA-Z0-9]+$/.test(pattern) ? `*${pattern}` : pattern
        )
      : undefined,
    exclude_globs: excludePatterns.length ? excludePatterns : undefined,
    exclude_dirs: [
      ...storeOptions.excludeDirs,
      ...excludePatterns.filter((pattern) => !/[*/?]/.test(pattern)),
    ],
  };
}
