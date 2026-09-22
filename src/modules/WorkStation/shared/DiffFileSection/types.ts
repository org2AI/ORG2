import type React from "react";

import type { GitFileStatus } from "@src/config/gitStatus";
import type { ReviewDiffSearch } from "@src/features/CodeMirror/Diff/reviewSearchNavigation";
import type { DiffViewMode } from "@src/types/git/types";

export interface DiffFileSectionData {
  path: string;
  original_path?: string | null;
  status: GitFileStatus;
  staged: boolean;
  additions?: number;
  deletions?: number;
  oldContent?: string;
  newContent?: string;
  oldStartLine?: number;
  newStartLine?: number;
  showLineNumbers?: boolean;
  unifiedDiff?: string;
  isBinary?: boolean;
  /** True when the file was edited but content could not be retrieved (e.g. Cursor IDE blob pruned). */
  isUnavailable?: boolean;
}

export interface DiffFileSectionProps {
  file: DiffFileSectionData;
  reviewSearch?: ReviewDiffSearch;
  viewMode: DiffViewMode;
  wordWrap?: boolean;
  defaultExpanded?: boolean;
  expansionSignal?: number;
  repoPath?: string;
  sectionRef?: React.RefObject<HTMLDivElement | null>;
  onFileSelect?: (path: string) => void;
  onRequestContent?: (file: DiffFileSectionData) => void;
  onExpansionChange?: (expanded: boolean) => void;
  hideDirectory?: boolean;
  showBottomBorder?: boolean;
  dataPath?: string;
  /** Show `current path ← original path` metadata for renamed files. */
  showRenamePath?: boolean;
  /**
   * When true, renders a flat FileHeader (matching source control style)
   * instead of the collapsible chevron button. Content is always expanded.
   */
  flat?: boolean;
  /** Reduce the section-header gutter when adjacent pane chrome already supplies separation. */
  compactHeaderGutter?: boolean;
  /**
   * When true, suppresses the bottom padding added by the diff viewer
   * (used in contexts without a bottom panel, e.g. agent station diff).
   */
  noBottomPadding?: boolean;
}
