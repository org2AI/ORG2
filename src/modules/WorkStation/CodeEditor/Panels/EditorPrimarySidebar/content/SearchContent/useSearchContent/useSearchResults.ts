/**
 * useSearchResults Hook
 *
 * Manages search results state via Jotai atoms.
 * Handles result memoization, load more (progressive loading),
 * and result clearing.
 */
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useMemo } from "react";

import {
  searchActualTotalFilesAtom,
  searchActualTotalMatchesAtom,
  searchAppendResultsAtom,
  searchClearAtom,
  searchErrorAtom,
  searchHasMoreAtom,
  searchLoadingAtom,
  searchLoadingMoreAtom,
  searchResultsAtom,
  searchTotalFilesAtom,
  searchTotalMatchesAtom,
} from "@src/store/workstation/codeEditor/search";

import { SEARCH_CONSTANTS } from "../config";
import type { SearchResultFile } from "../types";
import { toUIResult } from "./transformers";
import type { SearchResultActions } from "./types";

export interface UseSearchResultsReturn {
  /** Search results (UI format) */
  results: SearchResultFile[];
  /** Loading state */
  loading: boolean;
  /** Loading more results */
  loadingMore: boolean;
  /** Error message */
  error: string | null;
  /** Whether more results are available */
  hasMore: boolean;
  /** Total matches (loaded) */
  totalMatches: number;
  /** Total files (loaded) */
  totalFiles: number;
  /** Actual total matches (may be more than loaded) */
  actualTotalMatches: number;
  /** Actual total files (may be more than loaded) */
  actualTotalFiles: number;
  /** Whether results were truncated at max limit */
  isTruncated: boolean;
  /** Clear all results and reset state */
  clearResults: () => void;
  /** Actions for useSearchExecution to manage state */
  actions: SearchResultActions;
}

export function useSearchResults(): UseSearchResultsReturn {
  // Read from Jotai atoms
  const [storeResults, setResults] = useAtom(searchResultsAtom);
  const [loading, setLoading] = useAtom(searchLoadingAtom);
  const [loadingMore, setLoadingMore] = useAtom(searchLoadingMoreAtom);
  const [error, setError] = useAtom(searchErrorAtom);
  const [hasMore, setHasMore] = useAtom(searchHasMoreAtom);
  const [actualTotalMatches, setActualTotalMatches] = useAtom(
    searchActualTotalMatchesAtom
  );
  const [actualTotalFiles, setActualTotalFiles] = useAtom(
    searchActualTotalFilesAtom
  );
  const totalMatches = useAtomValue(searchTotalMatchesAtom);
  const totalFiles = useAtomValue(searchTotalFilesAtom);
  const appendResults = useSetAtom(searchAppendResultsAtom);
  const clearAtom = useSetAtom(searchClearAtom);

  // PERFORMANCE: Memoize results array to prevent recreation on every render.
  // Critical for scroll preservation — VirtualizedSearchResults uses
  // arePropsEqual which compares results by reference.
  const results = useMemo(() => storeResults.map(toUIResult), [storeResults]);

  const clearResults = useCallback(() => {
    clearAtom();
  }, [clearAtom]);

  const isTruncated = actualTotalMatches >= SEARCH_CONSTANTS.MAX_TOTAL_RESULTS;

  // Actions interface for useSearchExecution
  const actions: SearchResultActions = useMemo(
    () => ({
      setLoadingMore,
      setResults,
      setLoading,
      setError,
      setHasMore,
      setActualTotalMatches,
      setActualTotalFiles,
      appendResults,
      clearAtom,
    }),
    [
      setLoadingMore,
      setResults,
      setLoading,
      setError,
      setHasMore,
      setActualTotalMatches,
      setActualTotalFiles,
      appendResults,
      clearAtom,
    ]
  );

  return {
    results,
    loading,
    loadingMore,
    error,
    hasMore,
    totalMatches,
    totalFiles,
    actualTotalMatches,
    actualTotalFiles,
    isTruncated,
    clearResults,
    actions,
  };
}
