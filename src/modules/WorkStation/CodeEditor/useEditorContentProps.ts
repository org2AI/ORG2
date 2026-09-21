import type { UseTerminalStateReturn } from "@/src/engines/TerminalCore/types";
import { type ReactNode, useMemo } from "react";

import type { CursorPosition } from "../shared";
import type { SourceControlFilterMode } from "../shared/SidebarModules";
import type { EditorContentProps } from "./Panels/EditorMainPane/types";
import type { UseCodeEditorReturn } from "./hooks/useCodeEditor";
import type { UseCodeEditorHandlersReturn } from "./hooks/useCodeEditorHandlers";
import type { UseGitDiffStateReturn } from "./hooks/useGitDiffState";

interface UseEditorContentPropsOptions {
  codeEditorState: UseCodeEditorReturn;
  handlers: UseCodeEditorHandlersReturn;
  gitDiffState: UseGitDiffStateReturn;
  repoPath: string;
  repoName: string;
  selectedRepoId: string;
  handleAllChangesClick: () => void;
  handleCursorPositionChange: (position: CursorPosition | null) => void;
  terminalState: UseTerminalStateReturn;
  retainedTabIds: ReadonlySet<string>;
  isSourceControlActive: boolean;
  sourceControlHeaderScopePicker: ReactNode;
  sourceControlHeaderFilter: ReactNode;
  sourceControlFilterMode: SourceControlFilterMode;
  sourceControlActiveRepoRoot: string;
}

/**
 * Props for the main pane (`EditorContent`), memoized on exactly the fields
 * it reads. Source Control header controls only apply while the Source
 * Control tab is active. `onExplorerRefresh` is attached by the host.
 */
export function useEditorContentProps({
  codeEditorState,
  handlers,
  gitDiffState,
  repoPath,
  repoName,
  selectedRepoId,
  handleAllChangesClick,
  handleCursorPositionChange,
  terminalState,
  retainedTabIds,
  isSourceControlActive,
  sourceControlHeaderScopePicker,
  sourceControlHeaderFilter,
  sourceControlFilterMode,
  sourceControlActiveRepoRoot,
}: UseEditorContentPropsOptions): Omit<
  EditorContentProps,
  "onExplorerRefresh"
> {
  // Destructure state for component usage
  const {
    filesByPath: gitFilesByPath,
    loading: gitDiffLoading,
    openTabs: gitDiffTabs,
  } = gitDiffState.state;
  const {
    handleFileSelect,
    handleFileSelectWithLine,
    handleContentChange,
    handleSave,
    handleDiscard,
  } = handlers;
  const repoDisplayName = repoName || repoPath.split("/").pop() || "Repo";

  const editorSourceControlScopePicker = isSourceControlActive
    ? sourceControlHeaderScopePicker
    : null;
  const editorSourceControlHeaderSlot = isSourceControlActive
    ? sourceControlHeaderFilter
    : null;
  const editorSourceControlFilterMode = isSourceControlActive
    ? sourceControlFilterMode
    : "uncommitted";
  const editorShowSourceControlModePill =
    isSourceControlActive &&
    sourceControlFilterMode !== "stashed" &&
    sourceControlFilterMode !== "history" &&
    sourceControlFilterMode !== "pr" &&
    sourceControlFilterMode !== "issues";

  return useMemo(
    () => ({
      selectedFile: codeEditorState.selectedFile,
      fileContent: codeEditorState.fileContent ?? "",
      loading: codeEditorState.loadingContent,
      error: codeEditorState.contentError,
      repoPath,
      repoId: selectedRepoId ?? repoPath,
      repoDisplayName,
      explorerLoading: codeEditorState.loading,
      gitDiffTabs,
      gitFilesByPath,
      gitDiffLoading,
      onFileSelect: handleFileSelect,
      onFileSelectWithLine: handleFileSelectWithLine,
      onContentChange: handleContentChange,
      onSave: handleSave,
      onDiscard: handleDiscard,
      onAllChangesClick: handleAllChangesClick,
      hasUnsavedChanges: codeEditorState.hasUnsavedChanges,
      saving: codeEditorState.saving,
      isBinary: codeEditorState.isBinary,
      onCursorPositionChange: handleCursorPositionChange,
      terminalState,
      retainedTabIds,
      sourceControlHeaderLeadingSlot: editorSourceControlScopePicker,
      sourceControlHeaderTrailingSlot: editorSourceControlHeaderSlot,
      sourceControlFilterMode: editorSourceControlFilterMode,
      sourceControlActiveRepoRoot,
      showSourceControlModePill: editorShowSourceControlModePill,
    }),
    [
      codeEditorState.selectedFile,
      codeEditorState.fileContent,
      codeEditorState.loadingContent,
      codeEditorState.contentError,
      codeEditorState.hasUnsavedChanges,
      codeEditorState.saving,
      codeEditorState.isBinary,
      repoPath,
      selectedRepoId,
      repoDisplayName,
      codeEditorState.loading,
      gitDiffTabs,
      gitFilesByPath,
      gitDiffLoading,
      handleFileSelect,
      handleFileSelectWithLine,
      handleContentChange,
      handleSave,
      handleDiscard,
      handleAllChangesClick,
      handleCursorPositionChange,
      terminalState,
      retainedTabIds,
      editorSourceControlScopePicker,
      editorSourceControlHeaderSlot,
      editorSourceControlFilterMode,
      sourceControlActiveRepoRoot,
      editorShowSourceControlModePill,
    ]
  );
}
