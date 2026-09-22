/**
 * Prop and internal state shapes of `GitDiffContent`.
 */
import type React from "react";

import type { ConflictResolutionChoice } from "@src/features/CodeMirror";
import type { GitFile } from "@src/types/git/types";

export interface GitDiffContentProps {
  /** Selected git file with diff content */
  gitFile: GitFile | null;
  /** Loading state */
  loading: boolean;
  /** Repository path */
  repoPath?: string;
  /** Callback when conflict is resolved */
  onResolveConflict?: (
    filePath: string,
    conflictId: string,
    choice: ConflictResolutionChoice
  ) => void;
  /** Callback when file content changes (for conflict resolution) */
  onContentChange?: (filePath: string, newContent: string) => void;
  /** Callback when reload is requested */
  onReload?: () => void;
  /** Callback when a file is selected from breadcrumb dropdown */
  onFileSelect?: (filePath: string) => void;
  /** Dismiss the focused file preview. */
  onClose?: () => void;
  /** Notify parent when local unsaved state changes (tab bar dot vs close) */
  onUnsavedChange?: (hasUnsaved: boolean) => void;
  /** Optional content rendered before the breadcrumb in the file header. */
  leadingHeaderSlot?: React.ReactNode;
  /**
   * When true, the file header is published into the global workstation tab
   * header. Source Control focus mode renders it inline above the diff editor.
   */
  publishHeaderToWorkstation?: boolean;
  /**
   * Optional node rendered in place of the default "select a file to view
   * changes" placeholder when no file is resolved. Source Control focus mode
   * passes its quick-actions placeholder here; regular diff tabs omit it and
   * keep the plain text placeholder.
   */
  emptyState?: React.ReactNode;
}

export interface CallbackRefs {
  onResolveConflict?: GitDiffContentProps["onResolveConflict"];
  onContentChange?: GitDiffContentProps["onContentChange"];
  onReload?: GitDiffContentProps["onReload"];
  onClose?: GitDiffContentProps["onClose"];
}

export interface SelectionDropdownState {
  visible: boolean;
  position: { x: number; y: number };
  text: string;
  fromLine: number;
  toLine: number;
}
