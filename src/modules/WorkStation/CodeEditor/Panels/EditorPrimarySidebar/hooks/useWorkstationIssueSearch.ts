/**
 * Client-side search for the workstation Issues panel: the live query, its
 * debounced copy, and the filter applied to each issue list.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { GitHubIssue } from "@src/services/git/operations/githubIssues";

import { filterIssuesByQuery } from "./workstationIssueHelpers";

export function useWorkstationIssueSearch() {
  const [searchQuery, setSearchQuery] = useState("");
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const handleSetSearchQuery = useCallback((q: string) => {
    setSearchQuery(q);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearch(q);
    }, 300);
  }, []);

  useEffect(() => {
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, []);

  const applySearch = useCallback(
    (list: GitHubIssue[]) => filterIssuesByQuery(list, debouncedSearch),
    [debouncedSearch]
  );

  return { applySearch, handleSetSearchQuery, searchQuery };
}
