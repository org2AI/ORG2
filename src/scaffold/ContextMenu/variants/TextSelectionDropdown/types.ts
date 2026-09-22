/**
 * TextSelectionDropdown Types
 *
 * TypeScript type definitions for the text selection dropdown.
 */
import type { RefObject } from "react";

import type { TextSelectionLayout } from "./config";

// ============================================
// Component Props
// ============================================

export interface TextSelectionDropdownProps {
  /** Whether the dropdown is visible */
  visible: boolean;
  /** Position of the dropdown */
  position: { x: number; y: number };
  /** The selected text content */
  selectedText: string;
  /** Source of the selection: terminal, browser, editor, or chat transcript */
  source: "terminal" | "browser" | "editor" | "chat";
  /** Callback when dropdown should close */
  onClose: () => void;
  /** Callback when "Ask Agent" is selected */
  onAskAgent?: (text: string) => void;
  /** Callback when "Add to Session Context" is selected with a session */
  onAddToContext?: (text: string, sessionId: string | null) => void;
  onAddFile?: () => void;
  onAddLines?: () => void;
  /** Callback when "Pin" is selected (chat source) */
  onPin?: (text: string) => void;
  /** Callback when "Reply to selection" is selected (chat source) */
  onReply?: (text: string) => void;
  /** Line numbers for editor selections (optional) */
  lineRange?: { fromLine: number; toLine: number };
  /**
   * Presentation: the stacked dropdown (default) or a horizontal pill of
   * text actions floated above the selection.
   */
  layout?: TextSelectionLayout;
  /** Custom class name */
  className?: string;
}

// ============================================
// Hook Types
// ============================================

export interface UseTextSelectionDropdownOptions {
  /** Container element to watch for selections */
  containerRef?: RefObject<HTMLElement | null>;
  /**
   * Anchor the menu to the selected text instead of the pointer: the
   * position becomes the top-left of the selection's bounding box, which an
   * `inline` menu floats above. Keeps the bar off the text it acts on, and
   * off the cursor, however the selection was made.
   */
  anchorToSelection?: boolean;
}

export interface UseTextSelectionDropdownReturn {
  /** Whether the dropdown is visible */
  visible: boolean;
  /** Position for the dropdown */
  position: { x: number; y: number };
  /** Currently selected text */
  selectedText: string;
  /** Show the dropdown at a position */
  showDropdown: (position: { x: number; y: number }, text: string) => void;
  /** Hide the dropdown */
  hideDropdown: () => void;
}
