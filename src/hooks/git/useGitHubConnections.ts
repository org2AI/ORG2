/**
 * useGitHubConnections — OSS stub.
 *
 * Git credentials live in the Connections wizard (`Integrations >
 * Connections`) under the Git adapter; rows are listed in
 * `Integrations > Git`. This stub keeps the import surface stable: it
 * always reports zero connections and a no-op `startConnect`.
 */
import { useCallback } from "react";

import type {
  GitHubBranch,
  GitHubConnection,
  GitHubRepo,
} from "@src/api/http/github/types";
import { createLogger } from "@src/hooks/logger";

const logger = createLogger("useGitHubConnections");

const EMPTY_REPOS: GitHubRepo[] = [];
const EMPTY_BRANCHES: GitHubBranch[] = [];
const EMPTY_REPOS_CACHE = new Map<string, GitHubRepo[]>();
const EMPTY_BRANCHES_CACHE = new Map<string, GitHubBranch[]>();
const EMPTY_LOADING_REPOS = new Set<string>();
const EMPTY_LOADING_BRANCHES = new Set<string>();

export interface UseGitHubConnectionsOptions {
  autoFetch?: boolean;
}

export interface UseGitHubConnectionsReturn {
  connections: GitHubConnection[];
  isLoading: boolean;
  error: string | null;
  hasConnections: boolean;
  refresh: () => Promise<void>;
  startConnect: () => Promise<void>;
  getReposForConnection: (connectionId: string) => Promise<GitHubRepo[]>;
  reposCache: Map<string, GitHubRepo[]>;
  loadingRepos: Set<string>;
  getBranchesForRepo: (
    connectionId: string,
    repoFullName: string
  ) => Promise<GitHubBranch[]>;
  branchesCache: Map<string, GitHubBranch[]>;
  loadingBranches: Set<string>;
}

export function useGitHubConnections(
  _options: UseGitHubConnectionsOptions = {}
): UseGitHubConnectionsReturn {
  const refresh = useCallback(async () => {
    /* no-op */
  }, []);

  const startConnect = useCallback(async () => {
    logger.warn(
      "GitHub App OAuth flow is disabled; use Integrations > Connections > Git."
    );
  }, []);

  const getReposForConnection = useCallback(
    async (_connectionId: string): Promise<GitHubRepo[]> => EMPTY_REPOS,
    []
  );

  const getBranchesForRepo = useCallback(
    async (
      _connectionId: string,
      _repoFullName: string
    ): Promise<GitHubBranch[]> => EMPTY_BRANCHES,
    []
  );

  return {
    connections: [],
    isLoading: false,
    error: null,
    hasConnections: false,
    refresh,
    startConnect,
    getReposForConnection,
    reposCache: EMPTY_REPOS_CACHE,
    loadingRepos: EMPTY_LOADING_REPOS,
    getBranchesForRepo,
    branchesCache: EMPTY_BRANCHES_CACHE,
    loadingBranches: EMPTY_LOADING_BRANCHES,
  };
}
