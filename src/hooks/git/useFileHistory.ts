/**
 * useFileHistory Hook
 *
 * Fetches Git commit history for a specific file using the Rust Git API.
 */
import { type GitCommitInfo, getGitCommits } from "@src/api/http/git";
import type { GitCommitsResponse } from "@src/api/http/git/types";
import { useAsyncData } from "@src/hooks/async/useAsyncData";

export interface UseFileHistoryOptions {
  /** Repository ID */
  repoId: string;
  /** File path to get history for */
  filePath: string | null;
  /** Maximum number of commits to fetch */
  limit?: number;
  /** Auto-load on mount */
  autoLoad?: boolean;
  /** Callback when history loads successfully */
  onSuccess?: (commits: GitCommitInfo[]) => void;
  /** Callback when history load fails */
  onError?: (error: string) => void;
}

export interface UseFileHistoryResult {
  /** Commit history for the file */
  commits: GitCommitInfo[];
  /** Loading state */
  loading: boolean;
  /** Error message */
  error: string | null;
  /** Refresh history */
  refresh: () => void;
  /** Total count of commits */
  totalCount: number | null;
}

const EMPTY_COMMITS: GitCommitInfo[] = [];

/**
 * Hook to fetch and manage file commit history
 */
export function useFileHistory({
  repoId,
  filePath,
  limit = 50,
  autoLoad = true,
  onSuccess,
  onError,
}: UseFileHistoryOptions): UseFileHistoryResult {
  const { data, loading, error, refresh } = useAsyncData<
    GitCommitsResponse["data"] | undefined,
    string
  >({
    key: `${repoId}\u0000${filePath ?? ""}\u0000${limit}`,
    // Don't fetch if no file is selected
    enabled: autoLoad && Boolean(filePath),
    initialData: undefined,
    query: () =>
      getGitCommits({
        repo_id: repoId,
        file_path: filePath ?? undefined,
        limit,
      }),
    onSuccess: (result) => {
      if (result) onSuccess?.(result.commits);
    },
    onError: (message) => onError?.(message),
  });

  return {
    commits: data?.commits ?? EMPTY_COMMITS,
    loading,
    error,
    refresh,
    totalCount: data?.total_count ?? null,
  };
}
