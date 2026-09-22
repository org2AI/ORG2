/**
 * Regex Search API
 *
 * Bounded text search: batch, streaming, and fast event adapters.
 */
import { rpc } from "@src/api/tauri/rpc";

import type { CodeSearchResult, SearchFilters } from "./types";

export async function searchCodeRegex(
  query: string,
  repoPaths: string[],
  filters?: SearchFilters,
  searchId?: string,
  repoRoot?: string
): Promise<CodeSearchResult[]> {
  return rpc.searchRegex.search({
    query,
    repoPaths,
    filters,
    searchId,
    repoRoot,
  }) as Promise<CodeSearchResult[]>;
}

/**
 * Start streaming code search - results are emitted via Tauri events.
 * Listen for 'search-result' and 'search-complete' events.
 */
export async function searchCodeStreaming(
  searchId: string,
  query: string,
  repoPath: string,
  filters?: SearchFilters
): Promise<void> {
  return rpc.searchRegex.startStreaming({
    searchId,
    query,
    repoPath,
    filters,
  });
}

/**
 * Cancel an in-progress search.
 * Returns true if the search was found and cancelled, false otherwise.
 */
export async function cancelSearch(searchId: string): Promise<boolean> {
  return rpc.searchRegex.cancel({ searchId });
}

/**
 * Start the bounded native text-search worker and receive streamed results.
 */
export async function searchCodeFast(
  searchId: string,
  query: string,
  repoPath: string,
  filters?: SearchFilters
): Promise<void> {
  return rpc.searchRegex.startFast({
    searchId,
    query,
    repoPath,
    filters,
  });
}
