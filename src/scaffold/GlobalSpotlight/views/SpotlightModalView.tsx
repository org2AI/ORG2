/**
 * SpotlightModalView Component
 *
 * Renders form content for repo actions (new, clone, import)
 * Separated from main component for better maintainability
 */
import React from "react";

import {
  CloneGitHubForm,
  CloneUrlForm,
  CreateWorkingDirectoryForm,
  CreateWorkspaceForm,
} from "../forms";
import type { UseCloneFormReturn } from "../hooks/forms/useCloneForm";
import type { UseCreateWorkspaceFormReturn } from "../hooks/forms/useCreateWorkspaceForm";
import type { UseWorkingDirectoryFormReturn } from "../hooks/forms/useWorkingDirectoryForm";
import type { PathSegment } from "../types";

// ============================================
// Types
// ============================================

interface SpotlightModalViewProps {
  sourceSegment: PathSegment;
  workingDirectoryForm: UseWorkingDirectoryFormReturn;
  cloneForm: UseCloneFormReturn;
  multiRepoWorkspaceForm?: UseCreateWorkspaceFormReturn;
  currentRepoId?: string;
  onCancel: () => void;
}

// ============================================
// Component
// ============================================

export const SpotlightModalView: React.FC<SpotlightModalViewProps> = ({
  sourceSegment,
  workingDirectoryForm,
  cloneForm,
  multiRepoWorkspaceForm,
  currentRepoId,
  onCancel,
}) => {
  switch (sourceSegment.id) {
    case "add-workspace-new":
      return (
        <CreateWorkingDirectoryForm
          directoryName={workingDirectoryForm.directoryName}
          onDirectoryNameChange={workingDirectoryForm.setDirectoryName}
          parentDirectoryPath={workingDirectoryForm.parentDirectoryPath}
          onParentDirectoryPathChange={
            workingDirectoryForm.setParentDirectoryPath
          }
          onChoosePath={() => workingDirectoryForm.handleChoosePath("new")}
          onCancel={onCancel}
          onSubmit={() =>
            workingDirectoryForm.handleCreateWorkingDirectory(
              workingDirectoryForm.directoryName,
              workingDirectoryForm.parentDirectoryPath
            )
          }
          loading={workingDirectoryForm.loading}
          hideHeader={true}
        />
      );

    case "add-workspace-clone-url":
      return (
        <CloneUrlForm
          repoUrl={cloneForm.repoUrl}
          onRepoUrlChange={cloneForm.setRepoUrl}
          localPath={cloneForm.localPath}
          onLocalPathChange={cloneForm.setLocalPath}
          onChoosePath={cloneForm.handleChoosePath}
          onCancel={onCancel}
          onSubmit={() => {
            cloneForm.handleClone(
              cloneForm.repoUrl.trim(),
              cloneForm.localPath
            );
          }}
          loading={cloneForm.loading}
          hideHeader={true}
        />
      );

    case "add-workspace-clone-github":
      return (
        <CloneGitHubForm
          filterText={cloneForm.filterText}
          onFilterTextChange={cloneForm.setFilterText}
          repositories={cloneForm.repositories}
          groupedRepos={cloneForm.groupedRepos}
          selectedRepo={cloneForm.selectedRepo}
          onSelectRepo={cloneForm.setSelectedRepo}
          localPath={cloneForm.localPath}
          onLocalPathChange={cloneForm.setLocalPath}
          isLoadingRepos={cloneForm.isLoadingRepos}
          onChoosePath={cloneForm.handleChoosePath}
          onFetchRepos={cloneForm.fetchGitHubRepos}
          onCancel={onCancel}
          onSubmit={() => {
            const repoUrl = `https://github.com/${cloneForm.repositories.find((repo) => repo.id === cloneForm.selectedRepo)?.full_name}.git`;
            cloneForm.handleClone(repoUrl, cloneForm.localPath);
          }}
          loading={cloneForm.loading}
          hideHeader={true}
        />
      );
    case "create-workspace":
      return multiRepoWorkspaceForm ? (
        <CreateWorkspaceForm
          repos={multiRepoWorkspaceForm.repos}
          currentRepoId={currentRepoId}
          editingWorkspace={multiRepoWorkspaceForm.editingWorkspace}
          onCancel={onCancel}
          onSubmit={multiRepoWorkspaceForm.handleSubmit}
          loading={multiRepoWorkspaceForm.loading}
          hideHeader={true}
        />
      ) : null;

    default:
      return null;
  }
};
