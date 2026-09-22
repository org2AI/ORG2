import { useMemo } from "react";

import type { EditorHostContextValue } from "./context/editorHostContext";
import type { UseFileContentManagerReturn } from "./hooks";

interface UseEditorHostValueOptions extends Omit<
  EditorHostContextValue,
  | "fileContentState"
  | "onGitDiffUnsavedChange"
  | "onBinaryUnsavedChange"
  | "repoId"
> {
  fileContentManager: UseFileContentManagerReturn;
  handleGitDiffUnsavedChange: (hasUnsaved: boolean) => void;
  handleBinaryUnsavedChange: (hasUnsaved: boolean) => void;
  repoId?: string | null;
}

/**
 * Publish the exact 14-field prop bag `TabContentRenderer` receives so
 * editor tab renderers mounted through `UnifiedTabContent` can consume it
 * via `useEditorHostContext`. Sourced from the SAME live instances the host
 * already holds — `fileContentManager` (live file-content manager) and
 * `terminalState` (live PTY) are passed by reference, never recreated.
 */
export function useEditorHostValue({
  fileContentManager,
  gitFilesByPath,
  gitDiffLoading,
  forceRefresh,
  onFileSelect,
  onFileSelectWithLine,
  onCursorPositionChange,
  handleGitDiffUnsavedChange,
  handleBinaryUnsavedChange,
  terminalState,
  repoPath,
  repoId,
}: UseEditorHostValueOptions): EditorHostContextValue {
  return useMemo<EditorHostContextValue>(
    () => ({
      fileContentState: fileContentManager,
      gitFilesByPath,
      gitDiffLoading,
      forceRefresh,
      onFileSelect,
      onFileSelectWithLine,
      onCursorPositionChange,
      onGitDiffUnsavedChange: handleGitDiffUnsavedChange,
      onBinaryUnsavedChange: handleBinaryUnsavedChange,
      terminalState,
      repoPath,
      repoId: repoId ?? null,
    }),
    [
      fileContentManager,
      gitFilesByPath,
      gitDiffLoading,
      forceRefresh,
      onFileSelect,
      onFileSelectWithLine,
      onCursorPositionChange,
      handleGitDiffUnsavedChange,
      handleBinaryUnsavedChange,
      terminalState,
      repoPath,
      repoId,
    ]
  );
}
