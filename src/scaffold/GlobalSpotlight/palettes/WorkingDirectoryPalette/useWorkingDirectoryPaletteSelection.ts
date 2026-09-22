import { useCallback } from "react";

import { repoApi } from "@src/api/tauri/repo";
import type { WorkspaceFolder } from "@src/types/workspace";

import {
  type AddWorkingDirectoryModalStage,
  useAddWorkingDirectoryFlow,
} from "../../hooks";
import type { RepoItem } from "../../types";

interface UseWorkingDirectoryPaletteSelectionOptions {
  isMultiRoot: boolean;
  dispatchSetFolders: (
    folders: WorkspaceFolder[],
    workspaceId?: string | null
  ) => void;
  onSelect: (repoId: string, repo: RepoItem) => void;
  onClose: () => void;
  modalStage: AddWorkingDirectoryModalStage;
  setModalStage: (stage: AddWorkingDirectoryModalStage) => void;
  refreshReposForce: () => Promise<void>;
}

/**
 * Row selection handlers plus the add-source flow they feed: picking a saved
 * repo (leaving any multi-root workspace first), picking a freshly added
 * repo by id, and importing a path seen in another tool.
 */
export function useWorkingDirectoryPaletteSelection({
  isMultiRoot,
  dispatchSetFolders,
  onSelect,
  onClose,
  modalStage,
  setModalStage,
  refreshReposForce,
}: UseWorkingDirectoryPaletteSelectionOptions) {
  const handleRepoSelectWithWorkspaceExit = useCallback(
    (repoId: string, repo: RepoItem) => {
      if (isMultiRoot) {
        dispatchSetFolders([], null);
      }
      onSelect(repoId, repo);
      onClose();
    },
    [isMultiRoot, dispatchSetFolders, onSelect, onClose]
  );

  const handleAddedRepoSelect = useCallback(
    async (repoId?: string) => {
      if (!repoId) return;
      const result = await repoApi.getRepoById(repoId);
      const repo = result.data;
      const repoItem: RepoItem = {
        id: repo.repo_id,
        name: repo.name,
        fs_uri: repo.path,
        kind: repo.kind,
      };
      onSelect(repoItem.id, repoItem);
      onClose();
    },
    [onClose, onSelect]
  );

  // ============ ADD WORKSPACE FLOW ============
  const workingDirectoryFlow = useAddWorkingDirectoryFlow({
    modalStage,
    setModalStage,
    onSuccess: handleAddedRepoSelect,
    onModalClose: () => {
      setModalStage(null);
    },
  });

  const handleExternalRecentSelect = useCallback(
    async (repo: RepoItem) => {
      const path = repo.fs_uri;
      if (!path) return;
      if (isMultiRoot) {
        dispatchSetFolders([], null);
      }
      await workingDirectoryFlow.workingDirectoryForm.handleImportWorkingDirectory(
        path
      );
      await refreshReposForce();
    },
    [
      workingDirectoryFlow.workingDirectoryForm,
      dispatchSetFolders,
      isMultiRoot,
      refreshReposForce,
    ]
  );

  return {
    handleRepoSelectWithWorkspaceExit,
    workingDirectoryFlow,
    handleExternalRecentSelect,
  };
}
