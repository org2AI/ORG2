/**
 * useSpotlightPickerActions Hook
 *
 * Workspace/branch/worktree selection and CRUD action handlers for
 * `GlobalSpotlightInner` — select workspace, select/create/remove a
 * worktree, select/create/delete a branch, checkout detached HEAD.
 * Domain operations close the host; route state belongs to the host alone.
 */
import { useCallback } from "react";

import { gitApi, removeGitWorktree } from "@src/api/http/git";
import type { GitWorktreeEntry } from "@src/api/http/git";
import i18n from "@src/i18n";
import { performBranchSwitch } from "@src/services/git/operations/performBranchSwitch";
import type { Repo } from "@src/store/repo";
import type { WorktreeLaunchSource } from "@src/store/session/worktreeLaunchSourceAtom";
import type { ActiveWorktreeSelection } from "@src/store/workspace";
import { showGitActionDialogSafely } from "@src/util/dialogs/gitActionDialog";

import {
  getWorktreeBaseRef,
  getWorktreeCreateName,
} from "../../globalSpotlight.helpers";
import type {
  DeleteBranchOptions,
  DeleteBranchResult,
  RemoveWorktreeOptions,
  RemoveWorktreeResult,
} from "../../palettes/BranchPalette/types";
import { refreshWorktreeMap } from "../../palettes/BranchPalette/useWorktreeMap";
import type { RepoItem } from "../../types";

// ============================================
// Types
// ============================================

interface UseSpotlightPickerActionsOptions {
  selectedRepoId: string;
  currentRepo: Repo | undefined;
  currentRepoPath: string;
  selectRepo: (repoId: string) => void;
  selectBranch: (branch: string) => Promise<void>;
  refreshBranches: () => Promise<void>;
  closeModal: () => void;
  setActiveWorktree: (selection: ActiveWorktreeSelection | null) => void;
  setCurrentBranch: (branch: string) => void;
}

interface UseSpotlightPickerActionsResult {
  handleWorkspaceSelect: (repoId: string, repo: RepoItem) => void;
  handleWorktreePickerSelect: (worktree: GitWorktreeEntry) => void;
  handleWorktreePickerCreate: (source: WorktreeLaunchSource) => Promise<void>;
  handleBranchPickerSelect: (branchName: string) => Promise<void>;
  handleCreateBranch: (
    branchName: string,
    startPoint?: string
  ) => Promise<void>;
  handleDeleteBranch: (
    branchName: string,
    options?: DeleteBranchOptions
  ) => Promise<DeleteBranchResult>;
  handleRemoveWorktree: (
    worktreePath: string,
    options?: RemoveWorktreeOptions
  ) => Promise<RemoveWorktreeResult>;
  handleCheckoutDetached: () => Promise<void>;
}

// ============================================
// Hook
// ============================================

export function useSpotlightPickerActions(
  deps: UseSpotlightPickerActionsOptions
): UseSpotlightPickerActionsResult {
  const {
    selectedRepoId,
    currentRepo,
    currentRepoPath,
    selectRepo,
    selectBranch,
    refreshBranches,
    closeModal,
    setActiveWorktree,
    setCurrentBranch,
  } = deps;

  const handleWorkspaceSelect = useCallback(
    (repoId: string, _repo: RepoItem) => {
      selectRepo(repoId);
      closeModal();
    },
    [closeModal, selectRepo]
  );

  const handleWorktreePickerSelect = useCallback(
    (worktree: GitWorktreeEntry) => {
      if (!selectedRepoId) return;
      setActiveWorktree({
        repoId: selectedRepoId,
        path: worktree.path,
        branch: worktree.branch,
        isMain: worktree.is_main,
      });
      setCurrentBranch(worktree.branch);
      closeModal();
    },
    [closeModal, selectedRepoId, setActiveWorktree, setCurrentBranch]
  );

  const handleWorktreePickerCreate = useCallback(
    async (source: WorktreeLaunchSource) => {
      if (!selectedRepoId || !currentRepoPath) {
        showGitActionDialogSafely("No repo selected", "error");
        return;
      }

      const name = getWorktreeCreateName(source);
      const basePath = currentRepoPath.replace(/[/\\]+$/, "");
      const worktreePath = `${basePath}/.orgii/worktrees/${name}`;
      try {
        const created = await gitApi.createGitWorktree({
          repo_id: selectedRepoId,
          repo_path: currentRepoPath,
          worktree_path: worktreePath,
          branch: name,
          base_ref: getWorktreeBaseRef(source),
        });
        await refreshWorktreeMap(selectedRepoId, currentRepoPath);
        handleWorktreePickerSelect(created);
        showGitActionDialogSafely(`Worktree "${name}" created`, "info");
      } catch (error) {
        showGitActionDialogSafely(
          error instanceof Error ? error.message : String(error),
          "error"
        );
      }
    },
    [currentRepoPath, handleWorktreePickerSelect, selectedRepoId]
  );

  const handleBranchPickerSelect = useCallback(
    async (branchName: string) => {
      // Await the guarded checkout BEFORE tearing down the modal — otherwise
      // closeModal() races the CheckoutConflictDialog selectBranch may open.
      await selectBranch(branchName);
      closeModal();
    },
    [closeModal, selectBranch]
  );

  const handleCreateBranch = useCallback(
    async (branchName: string, startPoint?: string) => {
      if (!selectedRepoId || !currentRepo) {
        showGitActionDialogSafely("No repo selected", "error");
        return;
      }

      const result = await performBranchSwitch(
        {
          repoId: selectedRepoId,
          repoPath: currentRepoPath || currentRepo.path,
        },
        branchName,
        true,
        startPoint
      );
      if (!result.success) return;

      closeModal();
    },
    [closeModal, currentRepo, currentRepoPath, selectedRepoId]
  );

  const handleDeleteBranch = useCallback(
    async (
      branchName: string,
      options?: DeleteBranchOptions
    ): Promise<DeleteBranchResult> => {
      if (!selectedRepoId || !currentRepo) {
        const message = "No repo selected";
        if (!options?.silent) {
          showGitActionDialogSafely(message, "error");
        }
        return { success: false, message };
      }

      const result = await gitApi.gitDeleteBranch({
        repo_id: selectedRepoId,
        repo_path: currentRepo.path,
        branch_name: branchName,
      });

      if (!result.success) {
        const message =
          result.error ||
          i18n.t("common:selectors.branch.messages.failedDelete", {
            branch: branchName,
          });
        if (!options?.silent) {
          showGitActionDialogSafely(message, "error");
        }
        return { success: false, message };
      }

      if (!options?.silent) {
        showGitActionDialogSafely(`Branch "${branchName}" deleted`, "info");
      }
      if (!options?.skipRefresh) {
        await refreshBranches();
      }
      return { success: true };
    },
    [currentRepo, refreshBranches, selectedRepoId]
  );

  const handleRemoveWorktree = useCallback(
    async (
      worktreePath: string,
      options?: RemoveWorktreeOptions
    ): Promise<RemoveWorktreeResult> => {
      if (!selectedRepoId || !currentRepo) {
        const message = "No repo selected";
        if (!options?.silent) {
          showGitActionDialogSafely(message, "error");
        }
        return { success: false, message };
      }

      try {
        await removeGitWorktree({
          repo_id: selectedRepoId,
          repo_path: currentRepo.path,
          worktree_path: worktreePath,
          force: true,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!options?.silent) {
          showGitActionDialogSafely(message, "error");
        }
        return { success: false, message };
      }

      if (!options?.silent) {
        showGitActionDialogSafely(`Worktree "${worktreePath}" removed`, "info");
      }
      if (!options?.skipRefresh) {
        await refreshBranches();
      }
      return { success: true };
    },
    [currentRepo, refreshBranches, selectedRepoId]
  );

  const handleCheckoutDetached = useCallback(async () => {
    if (!selectedRepoId || !currentRepo) {
      showGitActionDialogSafely("No repo selected", "error");
      return;
    }

    const result = await performBranchSwitch(
      { repoId: selectedRepoId, repoPath: currentRepoPath || currentRepo.path },
      "HEAD"
    );
    if (!result.success) return;
    await refreshBranches();

    closeModal();
  }, [
    closeModal,
    currentRepo,
    currentRepoPath,
    refreshBranches,
    selectedRepoId,
  ]);

  return {
    handleWorkspaceSelect,
    handleWorktreePickerSelect,
    handleWorktreePickerCreate,
    handleBranchPickerSelect,
    handleCreateBranch,
    handleDeleteBranch,
    handleRemoveWorktree,
    handleCheckoutDetached,
  };
}
