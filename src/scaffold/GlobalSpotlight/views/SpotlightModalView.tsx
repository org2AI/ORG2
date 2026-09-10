/**
 * SpotlightFormView Component
 *
 * Renders form content for repo actions (new, clone, import)
 * Separated from main component for better maintainability
 */
import React from "react";

import {
  CloneGitHubForm,
  CloneRepoForm,
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
          onChoosePath={async () => {
            const path = await workingDirectoryForm.handleChoosePath("new");
            if (path) workingDirectoryForm.setParentDirectoryPath(path);
            return path;
          }}
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

    case "add-workspace-clone":
      return (
        <CloneRepoForm
          subTab={cloneForm.subTab}
          onSubTabChange={cloneForm.setSubTab}
          filterText={cloneForm.filterText}
          onFilterTextChange={cloneForm.setFilterText}
          repositories={cloneForm.repositories}
          groupedRepos={cloneForm.groupedRepos}
          selectedRepo={cloneForm.selectedRepo}
          onSelectRepo={cloneForm.setSelectedRepo}
          repoUrl={cloneForm.repoUrl}
          onRepoUrlChange={cloneForm.setRepoUrl}
          localPath={cloneForm.localPath}
          onLocalPathChange={cloneForm.setLocalPath}
          isLoadingRepos={cloneForm.isLoadingRepos}
          onChoosePath={async () => {
            const path = await cloneForm.handleChoosePath();
            if (path) cloneForm.setLocalPath(path);
            return path;
          }}
          onFetchRepos={cloneForm.fetchGitHubRepos}
          onCancel={onCancel}
          onSubmit={() => {
            const repoUrl =
              cloneForm.subTab === "myGitHub"
                ? `https://github.com/${cloneForm.repositories.find((repo) => repo.id === cloneForm.selectedRepo)?.full_name}.git`
                : cloneForm.repoUrl.trim();
            cloneForm.handleClone(repoUrl, cloneForm.localPath);
          }}
          loading={false}
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
          onChoosePath={async () => {
            const path = await cloneForm.handleChoosePath();
            if (path) cloneForm.setLocalPath(path);
            return path;
          }}
          onCancel={onCancel}
          onSubmit={() => {
            cloneForm.handleClone(
              cloneForm.repoUrl.trim(),
              cloneForm.localPath
            );
          }}
          loading={false}
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
          onChoosePath={async () => {
            const path = await cloneForm.handleChoosePath();
            if (path) cloneForm.setLocalPath(path);
            return path;
          }}
          onFetchRepos={cloneForm.fetchGitHubRepos}
          onCancel={onCancel}
          onSubmit={() => {
            const repoUrl = `https://github.com/${cloneForm.repositories.find((repo) => repo.id === cloneForm.selectedRepo)?.full_name}.git`;
            cloneForm.handleClone(repoUrl, cloneForm.localPath);
          }}
          loading={false}
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

export default SpotlightModalView;
