/**
 * Remote Operations — push, pull, fetch, publish, sync
 */
import { gitApi } from "@src/api/http/git";
import { getGitHubGitCredentialForRemote } from "@src/api/tauri/github";
import { GIT_SETTINGS_REGISTRY } from "@src/config/settingsSchema/registry/git";
import { showGitErrorAndHandle } from "@src/hooks/git/gitErrorDialog";
import { createLogger } from "@src/hooks/logger";
import {
  type GitPullStrategy,
  gitPullStrategyAtom,
} from "@src/store/ui/editorSettingsAtom";
import {
  type GitAuthenticationDialogResult,
  showGitAuthenticationDialog,
} from "@src/util/dialogs/gitAuthenticationDialog";

import { noRepoContextFailure } from "./noRepoContext";
import type { GitOperationResult } from "./types";
import {
  getOutputIntegration,
  getRepoContext,
  getStore,
  parseGitError,
} from "./types";

const logger = createLogger("GitRemoteOps");

/** One user operation owns its original target through every await/retry.
 * Integration callbacks capture their hook's repo at creation, so retain that
 * same integration rather than picking up the newly selected editor's one.
 */
interface RemoteOperationScope {
  readonly repo: ReturnType<typeof getRepoContext>;
  readonly integration: ReturnType<typeof getOutputIntegration>;
  remoteUrl?: Promise<string | undefined>;
}

function captureRemoteScope(): RemoteOperationScope {
  const repo = getRepoContext();
  const integration = getOutputIntegration();
  return {
    repo: repo ? { ...repo } : null,
    integration: integration ? { ...integration } : integration,
  };
}

// ============================================
// Core Operations
// ============================================

/**
 * Push to remote
 * Uses streaming output if available, falls back to terminal
 */
export async function push(
  params: {
    force?: boolean;
    setUpstream?: boolean;
    remote?: string;
    branch?: string;
    showErrorDialog?: boolean;
  } = {}
): Promise<GitOperationResult> {
  return pushForScope({ ...params }, captureRemoteScope());
}

async function pushForScope(
  params: {
    force?: boolean;
    setUpstream?: boolean;
    remote?: string;
    branch?: string;
    showErrorDialog?: boolean;
  },
  scope: RemoteOperationScope
): Promise<GitOperationResult> {
  const integration = scope.integration;

  if (integration) {
    const result = await integration.pushWithOutput({
      remote: params.remote,
      branch: params.branch,
      force: params.force,
      set_upstream: params.setUpstream,
      showErrorDialog: params.showErrorDialog,
    });
    if (!result.success && result.errorType === "authentication_failed") {
      return (await retryPushWithAuth(scope, params)) ?? result;
    }
    return result;
  }

  const repo = scope.repo;
  if (repo) {
    try {
      await gitApi.gitPush({
        repo_id: repo.repoId,
        repo_path: repo.repoPath,
        remote: params.remote,
        branch: params.branch,
        force: params.force,
        set_upstream: params.setUpstream,
      });
      return { success: true, errorType: "none" };
    } catch (error) {
      const parsed = parseGitError(error);
      const result: GitOperationResult = {
        success: false,
        errorType: parsed.type,
        message: parsed.message,
      };
      if (result.errorType === "authentication_failed") {
        return (await retryPushWithAuth(scope, params)) ?? result;
      }
      return result;
    }
  }

  return noRepoContextFailure("the push");
}

/**
 * Read the user's preferred pull strategy from settings.
 * Falls back to the registry default rather than a literal: an unhydrated
 * settings atom must not silently pull with a different strategy at startup
 * than the one the app ships with.
 */
const DEFAULT_PULL_STRATEGY: GitPullStrategy =
  GIT_SETTINGS_REGISTRY["git.pullStrategy"].default;

function getUserPullStrategy(): GitPullStrategy {
  const strategy = getStore().get(gitPullStrategyAtom);
  return strategy ?? DEFAULT_PULL_STRATEGY;
}

async function getRemoteUrl(
  scope: RemoteOperationScope,
  remoteName?: string
): Promise<string | undefined> {
  const repo = scope.repo;
  if (!repo) return undefined;

  scope.remoteUrl ??= gitApi
    .getGitRemotes({
      repo_id: repo.repoId,
      repo_path: repo.repoPath,
    })
    .then((remotesData) => {
      const targetRemoteName = remoteName ?? "origin";
      const remote = remotesData?.remotes.find(
        (candidateRemote) => candidateRemote.name === targetRemoteName
      );
      return remote?.push_url ?? remote?.fetch_url ?? remote?.url;
    });
  return scope.remoteUrl;
}

async function readStoredGitCredential(
  scope: RemoteOperationScope,
  remoteName?: string
): Promise<GitAuthenticationDialogResult | null> {
  const repo = scope.repo;
  if (!repo) return null;

  const remoteUrl = await getRemoteUrl(scope, remoteName);
  if (!remoteUrl) return null;

  const credential = await gitApi.fillGitCredentials({
    repo_id: repo.repoId,
    repo_path: repo.repoPath,
    remoteUrl,
  });

  if (!credential?.found || !credential.username || !credential.password) {
    return null;
  }

  return {
    username: credential.username,
    token: credential.password,
    shouldStore: false,
  };
}

async function readGitHubConnectionCredential(
  scope: RemoteOperationScope,
  remoteName?: string
): Promise<GitAuthenticationDialogResult | null> {
  const remoteUrl = await getRemoteUrl(scope, remoteName);
  if (!remoteUrl) return null;

  try {
    const credential = await getGitHubGitCredentialForRemote(remoteUrl);
    if (!credential) return null;
    return {
      username: credential.username,
      token: credential.token,
      shouldStore: false,
    };
  } catch (error) {
    logger.warn("GitHub credential lookup failed:", error);
    return null;
  }
}

async function requestGitAuthToken(
  scope: RemoteOperationScope,
  operation: "push" | "pull" | "fetch" | "sync",
  remote?: string
): Promise<GitAuthenticationDialogResult | null> {
  const repo = scope.repo;
  const remoteUrl = await getRemoteUrl(scope, remote);
  return showGitAuthenticationDialog({
    operation,
    repoPath: repo?.repoPath,
    remote: remoteUrl ?? remote,
    onLoadStoredCredential: () => readStoredGitCredential(scope, remote),
  });
}

async function attemptPushWithAuth(
  scope: RemoteOperationScope,
  params: {
    force?: boolean;
    setUpstream?: boolean;
    remote?: string;
    branch?: string;
  },
  auth: GitAuthenticationDialogResult
): Promise<GitOperationResult> {
  const repo = scope.repo;
  if (!repo) return { success: false, errorType: "unknown" };

  try {
    await gitApi.gitPush({
      repo_id: repo.repoId,
      repo_path: repo.repoPath,
      remote: params.remote,
      branch: params.branch,
      force: params.force,
      set_upstream: params.setUpstream,
      authUsername: auth.username,
      authToken: auth.token,
      storeAuth: auth.shouldStore,
    });
    return { success: true, errorType: "none" };
  } catch (error) {
    const parsed = parseGitError(error);
    return {
      success: false,
      errorType: parsed.type,
      message: parsed.message,
    };
  }
}

async function retryPushWithAuth(
  scope: RemoteOperationScope,
  params: {
    force?: boolean;
    setUpstream?: boolean;
    remote?: string;
    branch?: string;
  }
): Promise<GitOperationResult | null> {
  const githubAuth = await readGitHubConnectionCredential(scope, params.remote);
  if (githubAuth) {
    const githubResult = await attemptPushWithAuth(scope, params, githubAuth);
    if (
      githubResult.success ||
      githubResult.errorType !== "authentication_failed"
    ) {
      return githubResult;
    }
  }

  const auth = await requestGitAuthToken(scope, "push", params.remote);
  if (!auth) return null;

  return attemptPushWithAuth(scope, params, auth);
}

async function attemptPullWithAuth(
  scope: RemoteOperationScope,
  params: {
    remote?: string;
    branch?: string;
    strategy: GitPullStrategy;
  },
  auth: GitAuthenticationDialogResult
): Promise<GitOperationResult> {
  const repo = scope.repo;
  if (!repo) return { success: false, errorType: "unknown" };

  try {
    await gitApi.gitPull({
      repo_id: repo.repoId,
      repo_path: repo.repoPath,
      remote: params.remote,
      branch: params.branch,
      strategy: params.strategy,
      authUsername: auth.username,
      authToken: auth.token,
      storeAuth: auth.shouldStore,
    });
    return { success: true, errorType: "none" };
  } catch (error) {
    const parsed = parseGitError(error);
    return {
      success: false,
      errorType: parsed.type,
      message: parsed.message,
    };
  }
}

async function retryPullWithAuth(
  scope: RemoteOperationScope,
  params: {
    remote?: string;
    branch?: string;
    strategy: GitPullStrategy;
  }
): Promise<GitOperationResult | null> {
  const githubAuth = await readGitHubConnectionCredential(scope, params.remote);
  if (githubAuth) {
    const githubResult = await attemptPullWithAuth(scope, params, githubAuth);
    if (
      githubResult.success ||
      githubResult.errorType !== "authentication_failed"
    ) {
      return githubResult;
    }
  }

  const auth = await requestGitAuthToken(scope, "pull", params.remote);
  if (!auth) return null;

  return attemptPullWithAuth(scope, params, auth);
}

async function attemptFetchWithAuth(
  scope: RemoteOperationScope,
  params: {
    remote?: string;
    prune?: boolean;
  },
  auth: GitAuthenticationDialogResult
): Promise<GitOperationResult> {
  const repo = scope.repo;
  if (!repo) return { success: false, errorType: "unknown" };

  try {
    await gitApi.gitFetch({
      repo_id: repo.repoId,
      repo_path: repo.repoPath,
      remote: params.remote,
      prune: params.prune,
      authUsername: auth.username,
      authToken: auth.token,
      storeAuth: auth.shouldStore,
    });
    return { success: true, errorType: "none" };
  } catch (error) {
    const parsed = parseGitError(error);
    return {
      success: false,
      errorType: parsed.type,
      message: parsed.message,
    };
  }
}

async function retryFetchWithAuth(
  scope: RemoteOperationScope,
  params: {
    remote?: string;
    prune?: boolean;
  }
): Promise<GitOperationResult | null> {
  const githubAuth = await readGitHubConnectionCredential(scope, params.remote);
  if (githubAuth) {
    const githubResult = await attemptFetchWithAuth(scope, params, githubAuth);
    if (
      githubResult.success ||
      githubResult.errorType !== "authentication_failed"
    ) {
      return githubResult;
    }
  }

  const auth = await requestGitAuthToken(scope, "fetch", params.remote);
  if (!auth) return null;

  return attemptFetchWithAuth(scope, params, auth);
}

/**
 * Pull from remote
 * Uses streaming output if available, falls back to terminal.
 * Respects the user's pull strategy setting (merge/rebase/ff-only).
 */
export async function pull(
  params: {
    remote?: string;
    branch?: string;
    strategy?: GitPullStrategy;
    showErrorDialog?: boolean;
  } = {}
): Promise<GitOperationResult> {
  return pullForScope({ ...params }, captureRemoteScope());
}

async function pullForScope(
  params: {
    remote?: string;
    branch?: string;
    strategy?: GitPullStrategy;
    showErrorDialog?: boolean;
  },
  scope: RemoteOperationScope
): Promise<GitOperationResult> {
  const strategy = params.strategy ?? getUserPullStrategy();
  const integration = scope.integration;

  if (integration) {
    const result = await integration.pullWithOutput({ ...params, strategy });
    if (!result.success && result.errorType === "authentication_failed") {
      return (
        (await retryPullWithAuth(scope, { ...params, strategy })) ?? result
      );
    }
    return result;
  }

  const repo = scope.repo;
  if (repo) {
    try {
      await gitApi.gitPull({
        repo_id: repo.repoId,
        repo_path: repo.repoPath,
        remote: params.remote,
        branch: params.branch,
        strategy,
      });
      return { success: true, errorType: "none" };
    } catch (error) {
      const parsed = parseGitError(error);
      const result: GitOperationResult = {
        success: false,
        errorType: parsed.type,
        message: parsed.message,
      };
      if (result.errorType === "authentication_failed") {
        return (
          (await retryPullWithAuth(scope, { ...params, strategy })) ?? result
        );
      }
      return result;
    }
  }

  return noRepoContextFailure("the pull");
}

/**
 * Fetch from remote
 * Uses streaming output if available, falls back to terminal
 */
export async function fetch(
  params: {
    remote?: string;
    prune?: boolean;
    showErrorDialog?: boolean;
  } = {}
): Promise<GitOperationResult> {
  return fetchForScope({ ...params }, captureRemoteScope());
}

async function fetchForScope(
  params: {
    remote?: string;
    prune?: boolean;
    showErrorDialog?: boolean;
  },
  scope: RemoteOperationScope
): Promise<GitOperationResult> {
  const integration = scope.integration;

  if (integration) {
    const result = await integration.fetchWithOutput(params);
    if (!result.success && result.errorType === "authentication_failed") {
      return (await retryFetchWithAuth(scope, params)) ?? result;
    }
    return result;
  }

  const repo = scope.repo;
  if (repo) {
    try {
      await gitApi.gitFetch({
        repo_id: repo.repoId,
        repo_path: repo.repoPath,
        remote: params.remote,
        prune: params.prune,
      });
      return { success: true, errorType: "none" };
    } catch (error) {
      const parsed = parseGitError(error);
      const result: GitOperationResult = {
        success: false,
        errorType: parsed.type,
        message: parsed.message,
      };
      if (result.errorType === "authentication_failed") {
        return (await retryFetchWithAuth(scope, params)) ?? result;
      }
      return result;
    }
  }

  return noRepoContextFailure("the fetch");
}

/**
 * Publish branch (push with --set-upstream)
 */
export async function publish(): Promise<GitOperationResult> {
  return push({ setUpstream: true });
}

/**
 * Sync (fetch → pull → push)
 *
 * Fetches first so local tracking refs are up-to-date before pull+push.
 * Without the preflight fetch, `git status` may report 0 behind while
 * the remote actually has new commits, causing a push rejection.
 */
export async function sync(
  params: { showErrorDialog?: boolean } = {}
): Promise<GitOperationResult> {
  const scope = captureRemoteScope();
  const fetchResult = await fetchForScope(
    {
      showErrorDialog: params.showErrorDialog,
    },
    scope
  );
  if (!fetchResult.success) {
    return fetchResult;
  }
  const pullResult = await pullForScope(
    {
      showErrorDialog: params.showErrorDialog,
    },
    scope
  );
  if (!pullResult.success) {
    return pullResult;
  }
  return pushForScope(
    {
      showErrorDialog: params.showErrorDialog,
    },
    scope
  );
}

// ============================================
// Operations with Error Dialog
// ============================================

/**
 * Defer native dialog display to the next event-loop tick.
 * Calling the Tauri dialog API synchronously from a WebKit event callback
 * (e.g. SSE end, fetch settlement) can trigger a main-thread rendering
 * mutex self-deadlock on macOS.
 */
function deferErrorDialog(
  options: Parameters<typeof showGitErrorAndHandle>[0]
) {
  setTimeout(() => {
    showGitErrorAndHandle(options);
  }, 0);
}

/**
 * Push to remote with error dialog on failure
 */
export async function pushWithDialog(
  params: { force?: boolean; setUpstream?: boolean } = {}
): Promise<GitOperationResult> {
  const integration = getOutputIntegration();
  const repoContext = getRepoContext();
  const result = await push(params);

  if (!integration && !result.success && result.errorType !== "none") {
    deferErrorDialog({
      operation: "push",
      repoId: repoContext?.repoId,
      repoPath: repoContext?.repoPath,
      errorType: result.errorType,
      errorMessage: result.message || "Push failed",
    });
  }
  return result;
}

/**
 * Pull from remote with error dialog on failure
 */
export async function pullWithDialog(
  params: { remote?: string; branch?: string; strategy?: GitPullStrategy } = {}
): Promise<GitOperationResult> {
  const integration = getOutputIntegration();
  const repoContext = getRepoContext();
  const result = await pull(params);

  if (!integration && !result.success && result.errorType !== "none") {
    deferErrorDialog({
      operation: "pull",
      repoId: repoContext?.repoId,
      repoPath: repoContext?.repoPath,
      errorType: result.errorType,
      errorMessage: result.message || "Pull failed",
    });
  }
  return result;
}

/**
 * Fetch from remote with error dialog on failure
 */
export async function fetchWithDialog(
  params: { remote?: string; prune?: boolean } = {}
): Promise<GitOperationResult> {
  const integration = getOutputIntegration();
  const repoContext = getRepoContext();
  const result = await fetch(params);

  if (!integration && !result.success && result.errorType !== "none") {
    deferErrorDialog({
      operation: "fetch",
      repoId: repoContext?.repoId,
      repoPath: repoContext?.repoPath,
      errorType: result.errorType,
      errorMessage: result.message || "Fetch failed",
    });
  }
  return result;
}

/**
 * Sync (pull + push) with error dialog on failure
 */
export async function syncWithDialog(): Promise<GitOperationResult> {
  const integration = getOutputIntegration();
  const repoContext = getRepoContext();
  const result = await sync();

  if (!integration && !result.success && result.errorType !== "none") {
    deferErrorDialog({
      operation: "sync",
      repoId: repoContext?.repoId,
      repoPath: repoContext?.repoPath,
      errorType: result.errorType,
      errorMessage: result.message || "Sync failed",
    });
  }
  return result;
}
