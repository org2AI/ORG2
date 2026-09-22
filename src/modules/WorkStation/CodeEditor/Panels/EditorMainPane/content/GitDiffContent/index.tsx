/**
 * GitDiffContent Component
 *
 * Content-only component for displaying git diff.
 * Tab bar is rendered by parent (RightPanel) - this only handles content area.
 * Supports unified/split diff views and conflict resolution.
 *
 * Performance optimizations:
 * - Custom memo comparison to avoid rerenders on callback reference changes
 * - Uses refs for callbacks to prevent child component rebuilds
 */
import { useAtom, useAtomValue } from "jotai";
import React, { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";

import { Placeholder } from "@src/components/Placeholder";
import { hasConflictMarkers } from "@src/features/CodeMirror";
import type { FileHeaderProps } from "@src/features/FileHeader";
import { useEditorDisplayToggles } from "@src/hooks/settings/useEditorDisplayToggles";
import { FileHeader } from "@src/modules/WorkStation/shared";
import { EditorService } from "@src/services/workStation/EditorService";
import { activeStatusBarCallbacksAtom } from "@src/store/ui";
import { diffViewModeAtom } from "@src/store/workstation/codeEditor";

import { GitDiffBinaryPreview } from "./GitDiffBinaryPreview";
import { GitDiffEditorPane } from "./GitDiffEditorPane";
import { arePropsEqual } from "./arePropsEqual";
import { resolveGitDiffPresentation } from "./gitDiffPresentation";
import type { CallbackRefs, GitDiffContentProps } from "./types";
import { useGitDiffEditBuffer } from "./useGitDiffEditBuffer";
import { useGitDiffLoader } from "./useGitDiffLoader";
import { useGitDiffSelectionActions } from "./useGitDiffSelectionActions";

// ============================================
// Main Component
// ============================================

const GitDiffContentInner: React.FC<GitDiffContentProps> = ({
  gitFile,
  loading,
  repoPath = "",
  onResolveConflict,
  onContentChange,
  onReload,
  onFileSelect,
  onClose,
  onUnsavedChange,
  leadingHeaderSlot,
  publishHeaderToWorkstation = true,
  emptyState,
}) => {
  const { t } = useTranslation();
  const toggles = useEditorDisplayToggles();
  const { onOpenSettings } = useAtomValue(activeStatusBarCallbacksAtom);

  // ============================================
  // Callback refs for stable handler references
  // ============================================
  const callbackRefs = useRef<CallbackRefs>({});

  useEffect(() => {
    callbackRefs.current = {
      onResolveConflict,
      onContentChange,
      onReload,
      onClose,
    };
  });

  // View mode state for diff display
  const [viewMode, setViewMode] = useAtom(diffViewModeAtom);

  const { effectiveGitFile, selfFetching } = useGitDiffLoader({
    gitFile,
    repoPath,
  });

  const {
    editedContent,
    handleContentChange,
    handleDiscard,
    handleResolveConflict,
    handleSave,
    hasUnsavedChanges,
    saving,
  } = useGitDiffEditBuffer({
    callbackRefs,
    effectiveGitFile,
    gitFile,
    onUnsavedChange,
  });

  // Check if the file has merge conflict markers — reads from effective
  // content so the self-fetched diff feeds into conflict detection.
  const fileHasConflicts = useMemo(() => {
    const content = editedContent ?? effectiveGitFile?.newContent ?? "";
    return hasConflictMarkers(content);
  }, [editedContent, effectiveGitFile?.newContent]);

  const {
    handleAddToContext,
    handleAskAgent,
    handleCloseSelectionDropdown,
    handleTextSelection,
    selectionDropdown,
  } = useGitDiffSelectionActions({
    effectiveGitFilePath: effectiveGitFile?.path,
    t,
  });

  const handleCloseFocus = useCallback(() => {
    callbackRefs.current.onClose?.();
  }, []);

  // Handle reload - uses refs
  const handleReload = useCallback(() => {
    callbackRefs.current.onReload?.();
  }, []);

  const handleSearchRequest = useCallback(() => {
    EditorService.find();
  }, []);

  const handleGoToLineRequest = useCallback(() => {
    EditorService.openGoToLinePanel();
  }, []);

  // Loading spinner only when we have nothing else to show. Once a file
  // diff has been resolved we keep rendering it (and its FileHeader) even
  // if `loading` flicks back to true on the next git-status refresh —
  // otherwise the teleported breadcrumb / pill in the workstation tab-header
  // strip would pop in and out on every poll.
  if (loading && !effectiveGitFile) {
    return (
      <Placeholder
        variant="loading"
        placement="detail-panel"
        fillParentHeight
      />
    );
  }

  // No file selected. Source Control focus mode passes a quick-actions
  // placeholder via `emptyState`; regular diff tabs fall back to the plain
  // "select a file to view changes" text.
  if (!effectiveGitFile) {
    if (emptyState) {
      return <>{emptyState}</>;
    }
    return (
      <Placeholder
        variant="empty"
        placement="detail-panel"
        title={t("placeholders.selectFileToViewChanges")}
        fillParentHeight
      />
    );
  }

  // Path-derived fields resolve from metadata alone, so the header can render
  // before the diff body arrives.
  const {
    absoluteFilePath,
    isBinary,
    isBinaryPreviewType,
    newContentEmpty,
    oldContentEmpty,
    previewType,
    relativePath,
  } = resolveGitDiffPresentation(effectiveGitFile, repoPath);

  const baseHeaderProps: FileHeaderProps = {
    publishToHost: publishHeaderToWorkstation ? "code" : undefined,
    leadingSlot: leadingHeaderSlot,
    filePath: effectiveGitFile.path,
    repoPath,
    additions: effectiveGitFile.additions,
    deletions: effectiveGitFile.deletions,
    onReload: onReload ? handleReload : undefined,
    relativePathToCopy: relativePath,
    lineNumbersEnabled: toggles.lineNumbersEnabled,
    onLineNumbersChange: toggles.onLineNumbersChange,
    wordWrapEnabled: toggles.wordWrapEnabled,
    onWordWrapChange: toggles.onWordWrapChange,
    highlightActiveLineEnabled: toggles.highlightActiveLineEnabled,
    onHighlightActiveLineChange: toggles.onHighlightActiveLineChange,
    onMoreSettings: onOpenSettings,
    showSidebarSettings: publishHeaderToWorkstation,
    loading: loading || selfFetching,
    onFileSelect,
    showOpenFileAction: !!onFileSelect,
    onClose: onClose ? handleCloseFocus : undefined,
  };
  const textHeaderProps: FileHeaderProps = {
    ...baseHeaderProps,
    viewMode,
    onViewModeChange: setViewMode,
    onSearchRequest: handleSearchRequest,
    onGoToLineRequest: handleGoToLineRequest,
    // Split panes always wrap; keep the toggle visible but locked on.
    wordWrapLocked: viewMode === "split" && !fileHasConflicts,
  };

  // Content still missing — either the self-fetch is in flight or the parent
  // is still hydrating `gitDiffState.filesByPath`. Keep the header mounted
  // (its breadcrumb and "…" menu are published into the workstation header)
  // so switching files does not blink them, and show a spinner for the body
  // rather than fall through to the empty-content "file not found" branch.
  if (effectiveGitFile.oldContent === undefined) {
    return (
      <>
        <FileHeader
          {...(isBinary || isBinaryPreviewType
            ? baseHeaderProps
            : textHeaderProps)}
        />
        <Placeholder
          variant="loading"
          placement="detail-panel"
          fillParentHeight
        />
      </>
    );
  }

  // Route all binary/previewable files through a single switch on previewType.
  // This covers both sentinel-tagged files and untracked/new files that never
  // get a sentinel (e.g. a newly added PNG in source control).
  if (isBinary || isBinaryPreviewType) {
    const isDeleted = effectiveGitFile.status === "deleted";

    const fileHeader = <FileHeader {...baseHeaderProps} />;

    return (
      <GitDiffBinaryPreview
        absoluteFilePath={absoluteFilePath}
        fileHeader={fileHeader}
        isDeleted={isDeleted}
        previewType={previewType}
        relativePath={relativePath}
      />
    );
  }

  if (oldContentEmpty && newContentEmpty) {
    return (
      <Placeholder
        variant="empty"
        placement="detail-panel"
        title={t("placeholders.editorCouldNotOpenFileMissing")}
        subtitle={effectiveGitFile.path}
        fillParentHeight
      />
    );
  }

  // Show diff with header
  return (
    <>
      {/* File header with view mode toggle */}
      <FileHeader
        {...textHeaderProps}
        onSave={viewMode === "unified" ? handleSave : undefined}
        onDiscard={viewMode === "unified" ? handleDiscard : undefined}
        hasUnsavedChanges={hasUnsavedChanges}
      />

      {/* Content - Conflict Editor or Diff View */}
      <GitDiffEditorPane
        editedContent={editedContent}
        effectiveGitFile={effectiveGitFile}
        fileHasConflicts={fileHasConflicts}
        hasUnsavedChanges={hasUnsavedChanges}
        onAddToContext={handleAddToContext}
        onAskAgent={handleAskAgent}
        onCloseSelectionDropdown={handleCloseSelectionDropdown}
        onContentChange={handleContentChange}
        onDiscard={handleDiscard}
        onResolveConflict={handleResolveConflict}
        onSave={handleSave}
        onTextSelection={handleTextSelection}
        saving={saving}
        selectionDropdown={selectionDropdown}
        viewMode={viewMode}
      />
    </>
  );
};

// Memoize with custom comparison to prevent rerenders on callback changes
export const GitDiffContent = memo(GitDiffContentInner, arePropsEqual);

GitDiffContent.displayName = "GitDiffContent";

export default GitDiffContent;
