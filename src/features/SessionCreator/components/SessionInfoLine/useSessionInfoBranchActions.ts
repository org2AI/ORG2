/**
 * SessionInfoLine — branch actions.
 *
 * Guarded checkout on branch pick, plus the create / delete handlers the
 * Spotlight `BranchPalette` exposes. Every path reports through the shared
 * git action dialog and closes the branch selector on success.
 */
import { useCallback } from "react";

import { gitApi } from "@src/api/http/git";
import i18n from "@src/i18n";
import { performBranchSwitch } from "@src/services/git/operations/performBranchSwitch";
import { REPO_KIND, type RepoKind } from "@src/store/repo/types";
import { showGitActionDialogSafely } from "@src/util/dialogs/gitActionDialog";

interface UseSessionInfoBranchActionsOptions {
  repoId?: string;
  branchRepoPath: string;
  repoKind?: RepoKind;
  onBranchChange?: (branch: string) => void;
  setIsBranchSelectorOpen: (open: boolean) => void;
}

export function useSessionInfoBranchActions({
  repoId,
  branchRepoPath,
  repoKind,
  onBranchChange,
  setIsBranchSelectorOpen,
}: UseSessionInfoBranchActionsOptions) {
  const handleBranchSelect = useCallback(
    async (branch: string) => {
      if (!repoId || !branchRepoPath || repoKind === REPO_KIND.FOLDER) {
        onBranchChange?.(branch);
        setIsBranchSelectorOpen(false);
        return true;
      }

      const result = await performBranchSwitch(
        { repoId, repoPath: branchRepoPath },
        branch
      );
      if (result.currentBranch) onBranchChange?.(result.currentBranch);
      if (result.success) {
        setIsBranchSelectorOpen(false);
        return true;
      }
      return false;
    },
    [branchRepoPath, onBranchChange, repoId, repoKind, setIsBranchSelectorOpen]
  );

  const handleBranchPaletteSelect = useCallback(
    async (branch: string) => {
      return handleBranchSelect(branch);
    },
    [handleBranchSelect]
  );

  const handleCreateBranch = useCallback(
    async (branch: string, startPoint?: string) => {
      if (!repoId || !branchRepoPath) return;
      const result = await performBranchSwitch(
        { repoId, repoPath: branchRepoPath },
        branch,
        true,
        startPoint
      );
      if (result.currentBranch) onBranchChange?.(result.currentBranch);
      if (result.success) setIsBranchSelectorOpen(false);
    },
    [branchRepoPath, onBranchChange, repoId, setIsBranchSelectorOpen]
  );

  const handleDeleteBranch = useCallback(
    async (
      branch: string,
      options?: { silent?: boolean; skipRefresh?: boolean }
    ) => {
      if (!repoId || !branchRepoPath) {
        const message = "No repo selected";
        if (!options?.silent) {
          showGitActionDialogSafely(message, "error");
        }
        return { success: false, message };
      }

      const result = await gitApi.gitDeleteBranch({
        repo_id: repoId,
        repo_path: branchRepoPath,
        branch_name: branch,
      });

      if (!result.success) {
        const message =
          result.error ||
          i18n.t("common:selectors.branch.messages.failedDelete", {
            branch: branch,
          });
        if (!options?.silent) {
          showGitActionDialogSafely(message, "error");
        }
        return { success: false, message };
      }

      if (!options?.silent) {
        showGitActionDialogSafely(`Branch "${branch}" deleted`, "info");
      }
      return { success: true };
    },
    [branchRepoPath, repoId]
  );

  return {
    handleBranchSelect,
    handleBranchPaletteSelect,
    handleCreateBranch,
    handleDeleteBranch,
  };
}
