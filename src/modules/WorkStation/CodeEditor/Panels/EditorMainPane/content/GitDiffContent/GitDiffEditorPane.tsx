/**
 * Content area of `GitDiffContent`: the conflict editor or diff view, the
 * anchored text-selection dropdown, and the unsaved-changes floating bar.
 */
import React, { Suspense } from "react";
import { useTranslation } from "react-i18next";

import {
  CodeMirrorConflictEditor,
  CodeMirrorDiff,
  type ConflictResolutionChoice,
  type TextSelectionInfo,
} from "@src/features/CodeMirror";
import { FloatingBar } from "@src/modules/WorkStation/shared";
import { HUMANTOOLS_TEXT_KEYS } from "@src/modules/WorkStation/shared/textTokens";
import type { DiffViewMode, GitFile } from "@src/types/git/types";

import type { SelectionDropdownState } from "./types";

const LazyTextSelectionDropdown = React.lazy(
  () => import("@src/scaffold/ContextMenu/variants/TextSelectionDropdown")
);

export interface GitDiffEditorPaneProps {
  editedContent: string | null;
  effectiveGitFile: GitFile;
  fileHasConflicts: boolean;
  hasUnsavedChanges: boolean;
  onAddToContext: (text: string, sessionId: string | null) => void;
  onAskAgent: (text: string) => void;
  onCloseSelectionDropdown: () => void;
  onContentChange: (newContent: string) => void;
  onDiscard: () => void;
  onResolveConflict: (
    conflictId: string,
    choice: ConflictResolutionChoice
  ) => void;
  onSave: () => void;
  onTextSelection: (selection: TextSelectionInfo | null) => void;
  saving: boolean;
  selectionDropdown: SelectionDropdownState | null;
  viewMode: DiffViewMode;
}

export function GitDiffEditorPane({
  editedContent,
  effectiveGitFile,
  fileHasConflicts,
  hasUnsavedChanges,
  onAddToContext,
  onAskAgent,
  onCloseSelectionDropdown,
  onContentChange,
  onDiscard,
  onResolveConflict,
  onSave,
  onTextSelection,
  saving,
  selectionDropdown,
  viewMode,
}: GitDiffEditorPaneProps) {
  const { t } = useTranslation();
  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      {fileHasConflicts ? (
        /* Conflict Resolution Editor */
        <CodeMirrorConflictEditor
          content={editedContent ?? (effectiveGitFile.newContent || "")}
          filePath={effectiveGitFile.path}
          readOnly={false}
          onChange={onContentChange}
          onResolveConflict={onResolveConflict}
          height="100%"
        />
      ) : (
        /* Regular Diff View */
        <CodeMirrorDiff
          oldValue={effectiveGitFile.oldContent || ""}
          newValue={editedContent ?? (effectiveGitFile.newContent || "")}
          filePath={effectiveGitFile.path}
          changeType={effectiveGitFile.status}
          height="100%"
          viewMode={viewMode}
          wordWrap={viewMode === "split" ? true : undefined}
          readOnly={viewMode === "split"}
          mergeControls={false}
          collapseUnchanged={true}
          onChange={viewMode === "unified" ? onContentChange : undefined}
          onTextSelection={onTextSelection}
        />
      )}

      {selectionDropdown && !fileHasConflicts && (
        <Suspense fallback={null}>
          <LazyTextSelectionDropdown
            visible={selectionDropdown.visible}
            position={selectionDropdown.position}
            selectedText={selectionDropdown.text}
            source="editor"
            lineRange={{
              fromLine: selectionDropdown.fromLine,
              toLine: selectionDropdown.toLine,
            }}
            onClose={onCloseSelectionDropdown}
            onAskAgent={onAskAgent}
            onAddToContext={onAddToContext}
          />
        </Suspense>
      )}

      {((!fileHasConflicts && viewMode === "unified" && hasUnsavedChanges) ||
        (fileHasConflicts && hasUnsavedChanges)) && (
        <FloatingBar.Layer>
          {!fileHasConflicts && viewMode === "unified" && hasUnsavedChanges && (
            <FloatingBar
              variant="unsaved"
              message={t(HUMANTOOLS_TEXT_KEYS.placeholders.unsavedEdits)}
              saving={saving}
              onSave={onSave}
              onDiscard={onDiscard}
            />
          )}
          {fileHasConflicts && hasUnsavedChanges && (
            <FloatingBar
              variant="unsaved"
              message={t(
                HUMANTOOLS_TEXT_KEYS.placeholders.unsavedConflictResolutions
              )}
              saving={saving}
              onSave={onSave}
              onDiscard={onDiscard}
            />
          )}
        </FloatingBar.Layer>
      )}
    </div>
  );
}
