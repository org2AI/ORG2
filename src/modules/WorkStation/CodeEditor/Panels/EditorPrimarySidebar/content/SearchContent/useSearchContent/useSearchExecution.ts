/** Own the entire search request, including asynchronous listener registration. */
import { type UnlistenFn, listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useRef } from "react";

import {
  type SearchCompleteEvent,
  type SearchResultEvent,
  cancelSearch,
  searchCodeFast,
  searchCodeRegex,
} from "@src/api/tauri/search";
import { createLogger } from "@src/hooks/logger";
import i18n from "@src/i18n";
import type {
  SearchOptions,
  SearchResultFile,
} from "@src/store/workstation/codeEditor/search";
import { shareSearchLineContext } from "@src/store/workstation/codeEditor/search";

import { SEARCH_CONSTANTS } from "../config";
import type { SearchMode } from "../types";
import { buildSearchFilters, parseFilePatterns } from "./transformers";
import type { SearchResultActions } from "./types";

const log = createLogger("FileSearch");

interface Parameters {
  query: string;
  searchMode: SearchMode;
  repoPath: string;
  openFiles?: string[];
  storeOptions: SearchOptions;
  resultActions: SearchResultActions;
}
interface Owner {
  id: string;
  active: boolean;
  unlisten: UnlistenFn[];
  pending: SearchResultFile[];
  timer?: ReturnType<typeof setTimeout>;
  deadline?: ReturnType<typeof setTimeout>;
  stop: () => void;
}
export interface UseSearchExecutionReturn {
  search: (maxResults?: number, loadMore?: boolean) => Promise<void>;
  clear: () => void;
}

export function useSearchExecution({
  query,
  searchMode,
  repoPath,
  openFiles,
  storeOptions,
  resultActions,
}: Parameters): UseSearchExecutionReturn {
  const owner = useRef<Owner | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const key = JSON.stringify([
    query.trim(),
    searchMode,
    repoPath,
    [...(openFiles ?? [])].sort(),
    storeOptions,
  ]);
  // Stable semantic snapshot: unrelated renders cannot restart a request.
  const request = useMemo(
    () =>
      JSON.parse(key) as [string, SearchMode, string, string[], SearchOptions],
    [key]
  );
  const release = useCallback(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = undefined;
    const previous = owner.current;
    owner.current = null;
    if (!previous) return;
    previous.active = false;
    previous.stop();
    if (previous.deadline) clearTimeout(previous.deadline);
    if (previous.timer) clearTimeout(previous.timer);
    previous.pending = [];
    for (const unlisten of previous.unlisten) unlisten();
    previous.unlisten = [];
    void cancelSearch(previous.id).catch(() => undefined);
  }, []);
  const clear = useCallback(() => {
    release();
    resultActions.setLoading(false);
    resultActions.setLoadingMore?.(false);
    resultActions.clearAtom();
  }, [release, resultActions]);

  const search = useCallback(
    async (
      maxResults: number = SEARCH_CONSTANTS.INITIAL_MAX_RESULTS,
      loadMore = false
    ) => {
      release();
      const [text, , root, files, options] = request;
      if (!text || !root) {
        resultActions.clearAtom();
        return;
      }
      let stop!: () => void;
      const stopped = new Promise<void>((resolve) => {
        stop = resolve;
      });
      let complete!: () => void;
      const completed = new Promise<void>((resolve) => {
        complete = resolve;
      });
      const current: Owner = {
        stop,
        id: `search-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        active: true,
        unlisten: [],
        pending: [],
      };
      owner.current = current;
      const live = () => current.active && owner.current === current;
      current.deadline = setTimeout(() => {
        if (!live()) return;
        resultActions.setError(
          i18n.t("fileSearch.timeout", { ns: "navigation" })
        );
        resultActions.setLoading(false);
        resultActions.setLoadingMore?.(false);
        release();
      }, 20_000);
      const listenOwned = async <T>(
        name: string,
        handler: (event: { payload: T }) => void
      ) => {
        const registration = listen<T>(name, handler);
        const handle = await Promise.race([
          registration,
          stopped.then(() => null),
        ]);
        if (!handle) {
          void registration
            .then((unlisten) => unlisten())
            .catch(() => undefined);
          return null;
        }
        if (!live()) {
          handle();
          return null;
        }
        current.unlisten.push(handle);
        return handle;
      };
      const flush = () => {
        current.timer = undefined;
        if (!live() || !current.pending.length) return;
        resultActions.appendResults(current.pending);
        current.pending = [];
      };
      resultActions.setError(null);
      resultActions.setLoading(true);
      resultActions.setLoadingMore?.(loadMore);
      if (!loadMore) resultActions.setResults([]);
      resultActions.setHasMore(false);
      let received = false;
      const filters = {
        ...buildSearchFilters(
          options,
          parseFilePatterns(options.filesToInclude),
          parseFilePatterns(options.filesToExclude)
        ),
        max_results: Math.min(maxResults, SEARCH_CONSTANTS.MAX_TOTAL_RESULTS),
      };
      try {
        if (options.onlyOpenFiles) {
          const results = files.length
            ? await Promise.race([
                searchCodeRegex(text, files, filters, current.id, root),
                stopped.then(() => []),
              ])
            : [];
          if (!live()) return;
          resultActions.setResults(shareSearchLineContext(results));
          resultActions.setActualTotalFiles(results.length);
          const total = results.reduce((n, file) => n + file.matches.length, 0);
          resultActions.setActualTotalMatches(total);
          resultActions.setHasMore(
            total >= filters.max_results &&
              total < SEARCH_CONSTANTS.MAX_TOTAL_RESULTS
          );
        } else {
          const resultUnlisten = await listenOwned<SearchResultEvent>(
            "search-result",
            ({ payload }) => {
              if (!live() || payload.search_id !== current.id) return;
              // A larger request replaces its whole previous snapshot, including
              // additional matches in a file which was already visible.
              if (loadMore && !received) resultActions.setResults([]);
              received = true;
              current.pending.push(payload.result);
              if (!current.timer) current.timer = setTimeout(flush, 100);
              resultActions.setActualTotalMatches(payload.actual_matches);
              resultActions.setActualTotalFiles(payload.actual_files);
            }
          );
          if (!resultUnlisten) return;
          const completeUnlisten = await listenOwned<SearchCompleteEvent>(
            "search-complete",
            ({ payload }) => {
              if (!live() || payload.search_id !== current.id) return;
              if (current.timer) clearTimeout(current.timer);
              flush();
              if (loadMore && !received) resultActions.setResults([]);
              resultActions.setActualTotalMatches(payload.total_matches);
              resultActions.setActualTotalFiles(payload.total_files);
              resultActions.setHasMore(
                payload.has_more &&
                  payload.total_matches < SEARCH_CONSTANTS.MAX_TOTAL_RESULTS
              );
              if (payload.budget_exhausted)
                resultActions.setError(
                  i18n.t("fileSearch.budgetExceeded", { ns: "navigation" })
                );
              complete();
            }
          );
          if (!completeUnlisten) return;
          // IPC completion and queued WebView events can arrive in either order.
          await Promise.race([
            Promise.all([
              searchCodeFast(current.id, text, root, filters),
              completed,
            ]),
            stopped,
          ]);
        }
      } catch (error) {
        if (live())
          resultActions.setError(
            error instanceof Error ? error.message : String(error)
          );
      } finally {
        if (current.deadline) clearTimeout(current.deadline);
        if (live()) {
          if (current.timer) clearTimeout(current.timer);
          flush();
          resultActions.setLoading(false);
          resultActions.setLoadingMore?.(false);
          for (const unlisten of current.unlisten) unlisten();
          current.unlisten = [];
          current.active = false;
          owner.current = null;
        }
      }
    },
    [release, request, resultActions]
  );

  useEffect(() => {
    // Cleanup runs on *every* semantic change, before the replacement debounce.
    release();
    resultActions.setLoading(false);
    resultActions.setLoadingMore?.(false);
    resultActions.clearAtom();
    if (!request[0]) return;
    debounce.current = setTimeout(() => {
      debounce.current = undefined;
      void search().catch((error) => log.error("Search failed", error));
    }, SEARCH_CONSTANTS.DEBOUNCE_MS);
    return () => {
      release();
    };
  }, [request, search, release, resultActions]);

  return { search, clear };
}
