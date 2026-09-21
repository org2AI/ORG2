/**
 * Local edit buffer of `GitDiffContent`: the edited working-tree content,
 * its unsaved flag, the per-path draft mirror that survives tab switches,
 * and the save / discard / conflict handlers that act on it.
 */
import type React from "react";
import { useCallback, useEffect, useRef } from "react";

import { matchesShortcut } from "@src/config/keyboard/shortcutBindings";
import { useGitStatus } from "@src/contexts/git/GitStatusContext/useGitStatus";
import type { ConflictResolutionChoice } from "@src/features/CodeMirror";
import { createLogger } from "@src/hooks/logger";
import { registerBranchSwitchEditor } from "@src/services/git/operations/branchSwitchEditors";
import type { GitFile } from "@src/types/git/types";

import type { CallbackRefs, GitDiffContentProps } from "./types";
import { useGitDiffEditing } from "./useGitDiffEditing";

const log = createLogger("GitDiffContent");

export function useGitDiffEditBuffer({
  callbackRefs,
  effectiveGitFile,
  gitFile,
  onUnsavedChange,
}: {
  callbackRefs: React.RefObject<CallbackRefs>;
  effectiveGitFile: GitFile | null;
  gitFile: GitFile | null;
  onUnsavedChange: GitDiffContentProps["onUnsavedChange"];
}) {
  const { forceRefresh } = useGitStatus();
  const onSaved = useCallback(() => {
    void forceRefresh().catch((error: unknown) => {
      log.warn("[GitDiffContent] Refresh after save failed:", error);
    });
  }, [forceRefresh]);
  const onError = useCallback((error: unknown) => {
    log.error("[GitDiffContent] Save error:", error);
  }, []);
  const {
    editedContent,
    hasUnsavedChanges,
    saving,
    edit,
    discard: handleDiscard,
    save: handleSave,
    saveForSwitch,
  } = useGitDiffEditing(
    gitFile?.path,
    effectiveGitFile?.newContent,
    onSaved,
    onError
  );
  useEffect(() => {
    if (!gitFile) return;
    return registerBranchSwitchEditor({
      path: gitFile.path,
      dirty: () => hasUnsavedChanges,
      save: saveForSwitch,
    });
  }, [gitFile, hasUnsavedChanges, saveForSwitch]);
  const onUnsavedChangeRef = useRef(onUnsavedChange);
  useEffect(() => {
    onUnsavedChangeRef.current = onUnsavedChange;
  });
  useEffect(() => {
    onUnsavedChangeRef.current?.(hasUnsavedChanges);
  }, [hasUnsavedChanges]);

  // Store gitFile in ref for stable callback access
  const gitFileRef = useRef(effectiveGitFile);
  useEffect(() => {
    gitFileRef.current = effectiveGitFile;
  });

  // Handle content changes in the diff editor - uses refs
  const handleContentChange = useCallback(
    (newContent: string) => {
      const currentGitFile = gitFileRef.current;
      edit(newContent);
      // Notify parent of content change (for conflict resolution)
      if (currentGitFile?.path) {
        callbackRefs.current.onContentChange?.(currentGitFile.path, newContent);
      }
    },
    [callbackRefs, edit]
  );

  // Handle conflict resolution - uses refs
  const handleResolveConflict = useCallback(
    (conflictId: string, choice: ConflictResolutionChoice) => {
      const currentGitFile = gitFileRef.current;
      if (currentGitFile?.path) {
        callbackRefs.current.onResolveConflict?.(
          currentGitFile.path,
          conflictId,
          choice
        );
      }
    },
    [callbackRefs]
  );

  // Keyboard shortcut for save (Cmd/Ctrl+S)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (matchesShortcut(e, "save_file")) {
        e.preventDefault();
        handleSave().catch((error: unknown) => {
          log.error("[GitDiffContent] Save shortcut failed:", error);
        });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSave]);

  return {
    editedContent,
    handleContentChange,
    handleDiscard,
    handleResolveConflict,
    handleSave,
    hasUnsavedChanges,
    saving,
  };
}
