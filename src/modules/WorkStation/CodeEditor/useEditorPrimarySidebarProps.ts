import { useCallback, useMemo } from "react";

import type { PrimarySidebarTabKey } from "@src/store/ui/workStationLayout/primarySidebarAtoms";
import type { WorkspaceFolder } from "@src/types/workspace";

import type { EditorPrimarySidebarProps } from "./Panels/EditorPrimarySidebar/types";
import type { UseCodeEditorReturn } from "./hooks/useCodeEditor";
import type { UseCodeEditorHandlersReturn } from "./hooks/useCodeEditorHandlers";

interface UseEditorPrimarySidebarPropsOptions {
  codeEditorState: UseCodeEditorReturn;
  handlers: UseCodeEditorHandlersReturn;
  activeCommitSha: string | null;
  handleSymbolClick: (line: number) => void;
  repoPath: string;
  repoName: string;
  selectedRepoId: string;
  workspaceFolders: WorkspaceFolder[];
}

/**
 * Props for the default Explorer sidebar (`EditorPrimarySidebar`), memoized
 * on exactly the fields it reads. `onTimelineCommitClick` is attached by the
 * host.
 */
export function useEditorPrimarySidebarProps({
  codeEditorState,
  handlers,
  activeCommitSha,
  handleSymbolClick,
  repoPath,
  repoName,
  selectedRepoId,
  workspaceFolders,
}: UseEditorPrimarySidebarPropsOptions): Omit<
  EditorPrimarySidebarProps,
  "onTimelineCommitClick"
> {
  const {
    handleFileSelect,
    handleFileSelectWithLine,
    handleDirectoryToggle,
    handleFilterSearch,
    handleClearFilterSearch,
  } = handlers;

  // Tab change from EditorPrimarySidebar
  const handleTabChange = useCallback((_tab: PrimarySidebarTabKey) => {
    // Tab changes don't affect which files are displayed
  }, []);

  return useMemo(
    () => ({
      fileTree: codeEditorState.fileTree,
      selectedCommitSha: activeCommitSha,
      loading: codeEditorState.loading,
      error: codeEditorState.treeError,
      repoPath,
      repoId: selectedRepoId,
      repoName:
        workspaceFolders.length > 1
          ? `${workspaceFolders.length} repos`
          : repoName,
      searchResults: codeEditorState.searchResults,
      searchLoading: codeEditorState.searchLoading,
      searchQuery: codeEditorState.searchQuery,
      onFileSelect: handleFileSelect,
      onFileSelectWithLine: handleFileSelectWithLine,
      onDirectoryToggle: handleDirectoryToggle,
      onCollapseAll: codeEditorState.collapseAll,
      onFilterSearch: handleFilterSearch,
      onClearSearch: handleClearFilterSearch,
      onTabChange: handleTabChange,
      iconOnly: true,
      onSymbolClick: handleSymbolClick,
      onRevealFile: codeEditorState.revealFile,
      isMultiRoot: workspaceFolders.length > 1,
    }),
    [
      codeEditorState.fileTree,
      activeCommitSha,
      codeEditorState.loading,
      codeEditorState.treeError,
      repoPath,
      selectedRepoId,
      repoName,
      codeEditorState.searchResults,
      codeEditorState.searchLoading,
      codeEditorState.searchQuery,
      handleFileSelect,
      handleFileSelectWithLine,
      handleDirectoryToggle,
      codeEditorState.collapseAll,
      handleFilterSearch,
      handleClearFilterSearch,
      handleTabChange,
      handleSymbolClick,
      codeEditorState.revealFile,
      workspaceFolders.length,
    ]
  );
}
