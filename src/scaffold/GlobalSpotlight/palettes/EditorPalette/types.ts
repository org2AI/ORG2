/**
 * EditorPalette Types
 *
 * Type definitions for the editor palette component
 */
import type { SpotlightInitialEditorMode as EditorPaletteMode } from "@src/store/ui/uiAtom";

import type { SpotlightItem } from "../../shared";

// ============ EDITOR PALETTE MODES ============

export type { SpotlightInitialEditorMode as EditorPaletteMode } from "@src/store/ui/uiAtom";

// ============ STATE ============

export interface EditorPaletteState {
  isOpen: boolean;
  mode: EditorPaletteMode;
  query: string; // Raw input including prefix
  searchTerm: string; // Query with prefix stripped
  items: SpotlightItem[];
  isLoading: boolean;
}

// ============ MODE DETECTION RESULT ============

export interface ModeDetectionResult {
  mode: EditorPaletteMode;
  searchTerm: string;
}

// ============ FILE SEARCH RESULT ============

export interface FileSearchResult {
  path: string;
  name: string;
  directory: string;
  score?: number;
  repoPath?: string;
  repoName?: string;
}
