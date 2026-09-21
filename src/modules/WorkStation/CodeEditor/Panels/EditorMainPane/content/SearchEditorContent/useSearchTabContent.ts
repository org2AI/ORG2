import { useCallback, useEffect, useMemo, useState } from "react";

import { createLogger } from "@src/hooks/logger";
import type {
  SearchTabSessionState,
  SearchOptions as StoreSearchOptions,
  SearchResultFile as StoreSearchResultFile,
} from "@src/store/workstation/codeEditor/search";
import {
  DEFAULT_SEARCH_TAB_OPTIONS,
  createDefaultSearchTabSessionState,
  getSearchTabSessionState,
  setSearchTabSessionState,
} from "@src/store/workstation/codeEditor/search";

import { SEARCH_CONSTANTS } from "../../../EditorPrimarySidebar/content/SearchContent/config";
import type {
  SearchMode,
  SearchOptions,
  SearchResultFile,
} from "../../../EditorPrimarySidebar/content/SearchContent/types";
import {
  toUIOptions,
  toUIResult,
} from "../../../EditorPrimarySidebar/content/SearchContent/useSearchContent/transformers";
import { useSearchExecution } from "../../../EditorPrimarySidebar/content/SearchContent/useSearchContent/useSearchExecution";

interface UseSearchTabContentOptions {
  repoPath: string;
  openFiles?: string[];
  searchMode: SearchMode;
  sessionScopeId: string;
  initialQuery?: string;
  initialOptions?: StoreSearchOptions;
}

interface UseSearchTabContentReturn {
  query: string;
  submittedSearch: SearchTabSessionState["submittedSearch"];
  awaitingSubmission: boolean;
  refresh: () => void;
  setQuery: (value: string) => void;
  options: SearchOptions;
  setOptions: (value: Partial<SearchOptions>) => void;
  results: SearchResultFile[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  actualTotalMatches: number;
  actualTotalFiles: number;
  hasMore: boolean;
  isTruncated: boolean;
}

const log = createLogger("useSearchTabContent");
const NO_OPEN_FILES: string[] = [];

export function useSearchTabContent({
  repoPath,
  openFiles = NO_OPEN_FILES,
  searchMode,
  sessionScopeId,
  initialQuery,
  initialOptions,
}: UseSearchTabContentOptions): UseSearchTabContentReturn {
  const initialState = useMemo(() => {
    const cachedState = getSearchTabSessionState(sessionScopeId);
    if (cachedState) {
      return cachedState;
    }

    const seededState = createDefaultSearchTabSessionState();
    return {
      ...seededState,
      query: initialQuery ?? "",
      options: initialOptions ?? DEFAULT_SEARCH_TAB_OPTIONS,
    };
  }, [sessionScopeId, initialQuery, initialOptions]);
  const [query, setQuery] = useState<string>(initialState.query);
  const [submittedSearch, setSubmittedSearch] = useState(
    initialState.submittedSearch ?? null
  );
  const [storeOptions, setStoreOptions] = useState<StoreSearchOptions>(
    initialState.options
  );
  const [storeResults, setStoreResults] = useState<StoreSearchResultFile[]>(
    initialState.results
  );
  const [loading, setLoading] = useState<boolean>(false);
  const [loadingMore, _setLoadingMore] = useState<boolean>(
    initialState.loadingMore
  );
  const [error, setError] = useState<string | null>(initialState.error);
  const [hasMore, setHasMore] = useState<boolean>(initialState.hasMore);
  const [actualTotalMatches, setActualTotalMatches] = useState<number>(
    initialState.actualTotalMatches
  );
  const [actualTotalFiles, setActualTotalFiles] = useState<number>(
    initialState.actualTotalFiles
  );

  const options = useMemo(() => toUIOptions(storeOptions), [storeOptions]);
  const results = useMemo(() => storeResults.map(toUIResult), [storeResults]);

  const setOptions = useCallback((value: Partial<SearchOptions>) => {
    setStoreOptions((previousOptions) => ({
      ...previousOptions,
      caseSensitive: value.caseSensitive ?? previousOptions.caseSensitive,
      wholeWord: value.wholeWord ?? previousOptions.wholeWord,
      useRegex: value.useRegex ?? previousOptions.useRegex,
      fileExtensions: value.fileExtensions ?? previousOptions.fileExtensions,
      excludeDirs: value.excludeDirs ?? previousOptions.excludeDirs,
      filesToInclude: value.filesToInclude ?? previousOptions.filesToInclude,
      filesToExclude: value.filesToExclude ?? previousOptions.filesToExclude,
      onlyOpenFiles: value.onlyOpenFiles ?? previousOptions.onlyOpenFiles,
    }));
  }, []);

  const resultActions = useMemo(
    () => ({
      setResults: setStoreResults,
      setLoading,
      setError,
      setHasMore,
      setActualTotalMatches,
      setActualTotalFiles,
      appendResults: (incomingResults: StoreSearchResultFile[]) => {
        setStoreResults((previousResults) => [
          ...previousResults,
          ...incomingResults,
        ]);
      },
      clearAtom: () => {
        setStoreResults([]);
        setError(null);
        setHasMore(false);
        setActualTotalMatches(0);
        setActualTotalFiles(0);
      },
    }),
    []
  );

  const { refresh: executeSearch } = useSearchExecution({
    automatic: false,
    query,
    searchMode,
    repoPath,
    openFiles,
    storeOptions,
    resultActions,
  });

  const refresh = useCallback(() => {
    resultActions.clearAtom();
    setLoading(Boolean(query.trim()));
    setSubmittedSearch(query.trim() ? { query, options: storeOptions } : null);
    executeSearch().catch((error: unknown) => {
      log.error("Failed to execute submitted search", error);
    });
  }, [query, storeOptions, executeSearch, resultActions]);
  const awaitingSubmission =
    !submittedSearch ||
    query !== submittedSearch.query ||
    storeOptions !== submittedSearch.options;

  useEffect(() => {
    setSearchTabSessionState(sessionScopeId, {
      query,
      options: storeOptions,
      submittedSearch,
      results: storeResults,
      loading,
      loadingMore,
      error,
      hasMore,
      actualTotalMatches,
      actualTotalFiles,
    });
  }, [
    sessionScopeId,
    submittedSearch,
    query,
    storeOptions,
    storeResults,
    loading,
    loadingMore,
    error,
    hasMore,
    actualTotalMatches,
    actualTotalFiles,
  ]);

  const isTruncated = actualTotalMatches >= SEARCH_CONSTANTS.MAX_TOTAL_RESULTS;

  return {
    query,
    submittedSearch,
    awaitingSubmission,
    refresh,
    setQuery,
    options,
    setOptions,
    results,
    loading,
    loadingMore,
    error,
    actualTotalMatches,
    actualTotalFiles,
    hasMore,
    isTruncated,
  };
}
