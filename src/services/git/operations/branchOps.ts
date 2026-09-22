/**
 * Branch Operations — checkout, stash, stashPop, stashApply, stashDrop
 */
import { gitApi } from "@src/api/http/git";
import type { CheckoutErrorType } from "@src/api/http/git/branchOps";
import type { GitErrorType } from "@src/api/http/git/streaming";

import { noRepoContextFailure } from "./noRepoContext";
import { performBranchSwitch } from "./performBranchSwitch";
import {
  type GitOperationResult,
  getRepoContext,
  parseGitError,
} from "./types";

// ============================================
// Core Operations
// ============================================

/** Checkout through the same user-directed flow as every UI entry point. */
export async function checkoutRaw(
  branch: string,
  create?: boolean
): Promise<GitOperationResult> {
  return checkoutWithDialog(branch, create);
}

/**
 * Stash changes
 */
export async function stash(
  message?: string,
  includeUntracked?: boolean
): Promise<GitOperationResult> {
  const repo = getRepoContext();

  if (repo) {
    try {
      await gitApi.gitStashPush({
        repo_id: repo.repoId,
        repo_path: repo.repoPath,
        message: message || null,
        include_untracked: includeUntracked || false,
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

  return noRepoContextFailure("the stash");
}

/**
 * Pop a stash by index (apply and remove)
 */
export async function stashPop(index: number = 0): Promise<GitOperationResult> {
  const repo = getRepoContext();

  if (repo) {
    try {
      await gitApi.gitStashApply({
        repo_id: repo.repoId,
        repo_path: repo.repoPath,
        index,
        pop: true,
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

  return noRepoContextFailure("the stash pop");
}

/**
 * Apply stash without removing
 */
export async function stashApply(
  index: number = 0
): Promise<GitOperationResult> {
  const repo = getRepoContext();

  if (repo) {
    try {
      await gitApi.gitStashApply({
        repo_id: repo.repoId,
        repo_path: repo.repoPath,
        index,
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

  return noRepoContextFailure("the stash apply");
}

/**
 * Drop a stash
 */
export async function stashDrop(
  index: number = 0
): Promise<GitOperationResult> {
  const repo = getRepoContext();

  if (repo) {
    try {
      await gitApi.gitStashDrop({
        repo_id: repo.repoId,
        repo_path: repo.repoPath,
        index,
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

  // Destructive: the old fallback dropped whatever stash index N meant in
  // the terminal's own repository.
  return noRepoContextFailure("the stash drop");
}

// ============================================
// Operations with Error Dialog
// ============================================

/**
 * Map the guarded-checkout core's `CheckoutErrorType` onto the `GitErrorType`
 * used by the `GitOperationResult` contract that ActionSystem callers consume.
 */
function toGitErrorType(errorType: CheckoutErrorType | "none"): GitErrorType {
  if (errorType === "none") return "none";
  if (errorType === "uncommitted_changes") return "uncommitted_changes";
  // branch_not_found / merge_in_progress / rebase_in_progress / other have no
  // dedicated GitErrorType — surface them as the generic failure bucket.
  return "unknown";
}

/** Shared branch switching for ActionSystem callers. */
export async function checkoutWithDialog(
  branch: string,
  create?: boolean
): Promise<GitOperationResult> {
  const context = getRepoContext();
  if (!context) return noRepoContextFailure("the checkout");
  const result = await performBranchSwitch(context, branch, create);
  return {
    success: result.success,
    errorType: toGitErrorType(result.errorType),
    message: result.message,
  };
}
