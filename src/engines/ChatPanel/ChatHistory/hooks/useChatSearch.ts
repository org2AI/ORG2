/**
 * useChatSearch — Rust-backed search with projection-aware DOM scrolling.
 */
import { invoke } from "@tauri-apps/api/core";
import { useAtom, useSetAtom } from "jotai";
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useChatCollapseState } from "@src/engines/ChatPanel/ChatCollapseScope";
import { useEventNavigation } from "@src/engines/SessionCore";
import { DEBOUNCE_DELAYS, useDebouncedCallback } from "@src/hooks/perf";
import {
  chatFindInChatOpenAtomFamily,
  chatSearchSyncAtomFamily,
} from "@src/store/ui/chatPanel/miscAtoms";

import { agentOrgExecutionNavigationAtom } from "../agentOrgExecutionNavigation";
import type { OptimizedChatItem } from "../chatItemPipeline/types";
import type { ChatHistoryListHandle } from "../components/ChatHistoryList";
import {
  type BeginTranscriptNavigation,
  chatNavigationScopeKey,
} from "../viewport/transcriptNavigation";
import {
  EMPTY_CHAT_SEARCH_SYNC,
  buildChatSearchSyncState,
  useChatSearchPanePresentation,
  writeChatSearchSyncState,
} from "./chatSearch";
import { resolveVisibleSearchResultIndex } from "./chatSearch";
import {
  type ChatSearchModes,
  DEFAULT_CHAT_SEARCH_MODES,
  type MappedSearchResult,
  type RustSearchResult,
  mapRustResultsToSearchResults,
  searchChatHistoryLocally,
  wrapNextSearchResultIndex,
} from "./chatSearchHelpers";
import { buildEventIdProjectionIndex } from "./chatSearchProjection";
import type { ChatGroupMeta } from "./useChatGroups";
import { useChatSearchShortcut } from "./useChatSearchShortcut";
import type { ChatTurnPage } from "./useChatTurnPagination";

export type SearchResult = MappedSearchResult;

interface TurnPageSelection {
  pageIndex: number | null;
  sessionId: string | null;
}

export interface UseChatSearchOptions {
  sessionId: string | null;
  chatHistory: MappedSearchResult["item"][];
  flatItems: OptimizedChatItem[];
  sourceItems?: OptimizedChatItem[];
  originalToFlatIndex?: ReadonlyMap<number, number>;
  groupHeaders?: (OptimizedChatItem | null)[];
  groupCounts: number[];
  groupMeta: ChatGroupMeta[];
  pages: ChatTurnPage[];
  turnPaginationEnabled: boolean;
  currentPageIndex: number;
  setTurnPageSelection: Dispatch<SetStateAction<TurnPageSelection>>;
  virtualListRef: RefObject<ChatHistoryListHandle | null>;
  chatContainerRef: RefObject<HTMLDivElement | null>;
  onExplicitNavigation: BeginTranscriptNavigation;
  debounceMs?: number;
  maxResults?: number;
}

export interface UseChatSearchReturn {
  query: string;
  setQuery: (query: string) => void;
  results: SearchResult[];
  isSearching: boolean;
  isSearchActive: boolean;
  isSearchVisible: boolean;
  closeSearch: () => void;
  currentResultIndex: number;
  resultCount: number;
  nextResult: () => void;
  prevResult: () => void;
  caseSensitive: boolean;
  toggleCaseSensitive: () => void;
  useRegex: boolean;
  toggleRegex: () => void;
  wholeWord: boolean;
  toggleWholeWord: () => void;
}

async function fetchChatSearchResults(
  sessionId: string,
  chatHistory: UseChatSearchOptions["chatHistory"],
  query: string,
  modes: ChatSearchModes,
  maxResults: number
): Promise<SearchResult[]> {
  const trimmedQuery = query.trim();
  let rustResults: RustSearchResult[] = [];

  try {
    rustResults = await invoke<RustSearchResult[]>("es_search_chat_events", {
      sessionId,
      options: {
        query: trimmedQuery,
        caseSensitive: modes.caseSensitive,
        useRegex: modes.useRegex,
        wholeWord: modes.wholeWord,
        maxResults,
      },
    });
  } catch {
    return searchChatHistoryLocally(
      chatHistory,
      trimmedQuery,
      modes,
      maxResults
    );
  }

  const mapped = mapRustResultsToSearchResults(rustResults, chatHistory);
  if (mapped.length > 0) return mapped;

  return searchChatHistoryLocally(chatHistory, trimmedQuery, modes, maxResults);
}

function resolveScrollContainer(
  chatContainerRef: RefObject<HTMLDivElement | null>
): HTMLElement | null {
  const container = chatContainerRef.current;
  if (!container) return null;
  return (
    container.querySelector<HTMLElement>(
      '[data-testid="chat-history-scroll-container"]'
    ) ?? container
  );
}

export function useChatSearch(
  options: UseChatSearchOptions
): UseChatSearchReturn {
  const {
    sessionId,
    chatHistory,
    flatItems,
    sourceItems,
    originalToFlatIndex,
    groupHeaders,
    groupCounts,
    groupMeta,
    pages,
    turnPaginationEnabled,
    currentPageIndex,
    setTurnPageSelection,
    virtualListRef,
    chatContainerRef,
    onExplicitNavigation,
    debounceMs = DEBOUNCE_DELAYS.EXPENSIVE,
    maxResults = 100,
  } = options;

  const sessionKey = sessionId ?? "";
  const [isSearchVisible, setIsSearchVisible] = useAtom(
    chatFindInChatOpenAtomFamily(sessionKey)
  );
  const setChatSearchSync = useSetAtom(chatSearchSyncAtomFamily(sessionKey));
  useChatSearchShortcut(chatContainerRef, setIsSearchVisible, isSearchVisible);

  const [query, setQueryState] = useState("");
  // Only publish a query alongside the results that were computed for it.
  // Draft input must not trigger DOM highlighting in every replay pane.
  const [appliedQuery, setAppliedQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [currentResultIndex, setCurrentResultIndex] = useState(0);
  const [modes, setModes] = useState<ChatSearchModes>(
    DEFAULT_CHAT_SEARCH_MODES
  );

  const searchGenerationRef = useRef(0);
  const queryRef = useRef(query);
  queryRef.current = query;
  const modesRef = useRef(modes);
  modesRef.current = modes;
  const suppressScrollSyncRef = useRef(false);
  const groupMetaRef = useRef(groupMeta);
  groupMetaRef.current = groupMeta;
  const chatHistoryRef = useRef(chatHistory);
  chatHistoryRef.current = chatHistory;

  const [executionNavigation, setExecutionNavigation] = useAtom(
    agentOrgExecutionNavigationAtom
  );
  const preparedExecutionNavigationRef =
    useRef<typeof executionNavigation>(null);
  const { navigateToEvent } = useEventNavigation();
  const { setTurnCollapseOverrideAtom, setCollapseStateAtom } =
    useChatCollapseState();
  const setTurnCollapseOverride = useSetAtom(setTurnCollapseOverrideAtom);
  const setCollapseState = useSetAtom(setCollapseStateAtom);

  const projectionIndex = useMemo(
    () =>
      buildEventIdProjectionIndex(
        flatItems,
        groupCounts,
        groupMeta,
        sourceItems,
        originalToFlatIndex,
        groupHeaders
      ),
    [
      flatItems,
      groupCounts,
      groupMeta,
      sourceItems,
      originalToFlatIndex,
      groupHeaders,
    ]
  );
  const projectionIndexRef = useRef(projectionIndex);
  projectionIndexRef.current = projectionIndex;

  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const currentPageIndexRef = useRef(currentPageIndex);
  currentPageIndexRef.current = currentPageIndex;

  const resetLocalSearch = useCallback(() => {
    setQueryState("");
    setAppliedQuery("");
    setIsSearching(false);
    setResults([]);
    setCurrentResultIndex(0);
    setModes(DEFAULT_CHAT_SEARCH_MODES);
    writeChatSearchSyncState(setChatSearchSync, EMPTY_CHAT_SEARCH_SYNC);
    searchGenerationRef.current += 1;
  }, [setChatSearchSync]);

  const scrollToSearchResult = useCallback(
    (result: SearchResult) => {
      const eventId = result.item.id || result.item.chunk_id || "";
      const projection = eventId
        ? projectionIndexRef.current.get(eventId)
        : undefined;
      const pageIndex =
        turnPaginationEnabled && projection
          ? pagesRef.current.findIndex(
              (page) =>
                projection.groupIndex >= page.startGroupIndex &&
                projection.groupIndex <= page.endGroupIndex
            )
          : -1;
      const resolvedPage = pageIndex >= 0 ? pageIndex : null;
      const targetPageIndex = resolvedPage ?? currentPageIndexRef.current;
      onExplicitNavigation({
        id: eventId,
        scopeKey: chatNavigationScopeKey(
          sessionId,
          turnPaginationEnabled ? targetPageIndex : null
        ),
        readGeometry: () => {
          const current = projectionIndexRef.current.get(eventId);
          if (!current) {
            return {
              status: chatHistoryRef.current.some(
                (item) => item.id === eventId || item.chunk_id === eventId
              )
                ? "pending"
                : "missing",
            };
          }
          const page = turnPaginationEnabled
            ? pagesRef.current[targetPageIndex]
            : undefined;
          const anchorId = virtualListRef.current?.getGroupAnchorId(
            current.groupIndex - (page?.startGroupIndex ?? 0)
          );
          if (!anchorId) return { status: "pending" };
          return (
            virtualListRef.current?.readNavigationGeometry({
              anchorId,
              eventId,
              itemId: current.itemChunkId,
            }) ?? { status: "pending" }
          );
        },
        onEnd: () => {
          suppressScrollSyncRef.current = false;
        },
      });
      suppressScrollSyncRef.current = true;

      if (projection?.turnId) {
        setTurnCollapseOverride({
          turnId: projection.turnId,
          collapsed: false,
        });
      }
      if (eventId) {
        setCollapseState({ eventId, collapsed: false });
        navigateToEvent(eventId);
      }
      if (resolvedPage !== null && sessionId) {
        setTurnPageSelection({
          pageIndex: resolvedPage,
          sessionId,
        });
      }
    },
    [
      navigateToEvent,
      onExplicitNavigation,
      sessionId,
      setCollapseState,
      setTurnCollapseOverride,
      setTurnPageSelection,
      turnPaginationEnabled,
      virtualListRef,
    ]
  );

  useEffect(() => {
    if (!executionNavigation || executionNavigation.sessionId !== sessionId) {
      preparedExecutionNavigationRef.current = null;
      return;
    }
    const groupIndex = groupMeta.findIndex(
      (meta) =>
        meta.execution?.turnIntentId === executionNavigation.turnIntentId
    );
    if (groupIndex < 0) return;
    const targetPage = pages.findIndex(
      (page) =>
        page.startGroupIndex <= groupIndex && page.endGroupIndex >= groupIndex
    );
    if (turnPaginationEnabled && targetPage < 0) return;
    if (preparedExecutionNavigationRef.current === executionNavigation) return;
    preparedExecutionNavigationRef.current = executionNavigation;
    onExplicitNavigation({
      id: executionNavigation.turnIntentId,
      scopeKey: chatNavigationScopeKey(
        sessionId,
        turnPaginationEnabled ? targetPage : null
      ),
      readGeometry: () => {
        const index = groupMetaRef.current.findIndex(
          (meta) =>
            meta.execution?.turnIntentId === executionNavigation.turnIntentId
        );
        if (index < 0) return { status: "missing" };
        const page = turnPaginationEnabled
          ? pagesRef.current[targetPage]
          : undefined;
        const anchorId = virtualListRef.current?.getGroupAnchorId(
          index - (page?.startGroupIndex ?? 0)
        );
        return anchorId
          ? virtualListRef.current!.readNavigationGeometry({ anchorId })
          : { status: "pending" };
      },
      onEnd: () =>
        setExecutionNavigation((current) =>
          current === executionNavigation ? null : current
        ),
    });
    if (turnPaginationEnabled && targetPage !== currentPageIndex) {
      setTurnPageSelection({ sessionId, pageIndex: targetPage });
    }
    setTurnCollapseOverride({
      turnId: `agent-org-execution-${executionNavigation.turnIntentId}`,
      collapsed: false,
    });
  }, [
    executionNavigation,
    sessionId,
    flatItems,
    groupCounts,
    onExplicitNavigation,
    virtualListRef,
    setExecutionNavigation,
    groupMeta,
    pages,
    turnPaginationEnabled,
    currentPageIndex,
    setTurnPageSelection,
    setTurnCollapseOverride,
  ]);

  const performSearch = useCallback(
    async (
      searchQuery: string,
      searchModes: ChatSearchModes = modesRef.current
    ) => {
      const trimmedQuery = searchQuery.trim();
      if (!trimmedQuery || chatHistory.length === 0 || !sessionId) {
        setAppliedQuery("");
        setResults([]);
        setCurrentResultIndex(0);
        setIsSearching(false);
        return;
      }

      setIsSearching(true);
      const generation = ++searchGenerationRef.current;

      try {
        const searchResults = await fetchChatSearchResults(
          sessionId,
          chatHistory,
          trimmedQuery,
          searchModes,
          maxResults
        );

        if (generation !== searchGenerationRef.current) return;

        setAppliedQuery(trimmedQuery);
        setResults(searchResults);
        setCurrentResultIndex(0);
        setIsSearching(false);

        const first = searchResults[0];
        if (first) scrollToSearchResult(first);
      } catch {
        if (generation !== searchGenerationRef.current) return;
        setAppliedQuery("");
        setResults([]);
        setCurrentResultIndex(0);
        setIsSearching(false);
      }
    },
    [chatHistory, maxResults, scrollToSearchResult, sessionId]
  );

  const debouncedPerformSearch = useDebouncedCallback(
    (q: string) => performSearch(q),
    debounceMs
  );

  useEffect(() => {
    resetLocalSearch();
    debouncedPerformSearch.cancel();
  }, [sessionId, resetLocalSearch, debouncedPerformSearch]);

  useEffect(() => {
    if (!isSearchVisible) {
      debouncedPerformSearch.cancel();
      resetLocalSearch();
    }
  }, [isSearchVisible, debouncedPerformSearch, resetLocalSearch]);

  useEffect(
    () => () => {
      searchGenerationRef.current += 1;
    },
    []
  );

  const handleQueryChange = useCallback(
    (newQuery: string) => {
      setQueryState(newQuery);
      queryRef.current = newQuery;
      // Invalidate requests immediately, including during the debounce window.
      searchGenerationRef.current += 1;
      if (!newQuery.trim()) {
        setAppliedQuery("");
        debouncedPerformSearch.cancel();
        setResults([]);
        setCurrentResultIndex(0);
        setIsSearching(false);
        return;
      }
      setIsSearching(true);
      debouncedPerformSearch(newQuery);
    },
    [debouncedPerformSearch]
  );

  const navigateToResult = useCallback(
    (resultIndex: number) => {
      const result = results[resultIndex];
      if (!result) return;
      setCurrentResultIndex(resultIndex);
      scrollToSearchResult(result);
    },
    [results, scrollToSearchResult]
  );

  const nextResult = useCallback(() => {
    if (debouncedPerformSearch.pending()) {
      debouncedPerformSearch.flush();
      return;
    }
    if (isSearching || results.length === 0) return;
    navigateToResult(
      wrapNextSearchResultIndex(currentResultIndex, results.length, 1)
    );
  }, [
    currentResultIndex,
    debouncedPerformSearch,
    isSearching,
    navigateToResult,
    results.length,
  ]);

  const prevResult = useCallback(() => {
    if (debouncedPerformSearch.pending()) {
      debouncedPerformSearch.flush();
      return;
    }
    if (isSearching || results.length === 0) return;
    navigateToResult(
      wrapNextSearchResultIndex(currentResultIndex, results.length, -1)
    );
  }, [
    currentResultIndex,
    debouncedPerformSearch,
    isSearching,
    navigateToResult,
    results.length,
  ]);

  const closeSearch = useCallback(() => {
    debouncedPerformSearch.cancel();
    resetLocalSearch();
    setIsSearchVisible(false);
  }, [debouncedPerformSearch, resetLocalSearch, setIsSearchVisible]);

  const toggleSearchMode = useCallback(
    (key: keyof ChatSearchModes) => {
      const next = { ...modesRef.current, [key]: !modesRef.current[key] };
      modesRef.current = next;
      setModes(next);
      debouncedPerformSearch.cancel();
      if (queryRef.current.trim()) {
        void performSearch(queryRef.current, next);
      }
    },
    [debouncedPerformSearch, performSearch]
  );

  useChatSearchPanePresentation({
    sessionId,
    highlightRootRef: chatContainerRef,
  });

  useEffect(() => {
    writeChatSearchSyncState(
      setChatSearchSync,
      buildChatSearchSyncState({
        isOpen: isSearchVisible,
        query: appliedQuery,
        results,
        currentResultIndex,
      })
    );
  }, [
    appliedQuery,
    currentResultIndex,
    isSearchVisible,
    results,
    setChatSearchSync,
  ]);

  useEffect(() => {
    if (!isSearchVisible || results.length === 0) return;

    const scrollRoot = resolveScrollContainer(chatContainerRef);
    if (!scrollRoot) return;

    let frame = 0;
    const handleScroll = () => {
      if (suppressScrollSyncRef.current) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const visibleIndex = resolveVisibleSearchResultIndex(
          scrollRoot,
          results.map((result) => result.item.id || result.item.chunk_id || "")
        );
        if (visibleIndex !== null) {
          setCurrentResultIndex(visibleIndex);
        }
      });
    };

    scrollRoot.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      scrollRoot.removeEventListener("scroll", handleScroll);
      cancelAnimationFrame(frame);
    };
  }, [chatContainerRef, isSearchVisible, results]);

  return {
    query,
    setQuery: handleQueryChange,
    results,
    isSearching,
    isSearchActive: query.trim().length > 0,
    isSearchVisible,
    closeSearch,
    currentResultIndex,
    resultCount: results.length,
    nextResult,
    prevResult,
    caseSensitive: modes.caseSensitive,
    toggleCaseSensitive: () => toggleSearchMode("caseSensitive"),
    useRegex: modes.useRegex,
    toggleRegex: () => toggleSearchMode("useRegex"),
    wholeWord: modes.wholeWord,
    toggleWholeWord: () => toggleSearchMode("wholeWord"),
  };
}

export default useChatSearch;
