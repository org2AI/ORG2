/**
 * Sidebar Configuration
 *
 * Centralized configuration for sidebar styling and behavior.
 */
import { WINDOW_CHROME_TOKENS } from "@src/config/windowChromeTokens";

/** Hover dwell time before previewing a collapsed sidebar. */
export const SIDEBAR_HOVER_PREVIEW_DELAY = 750;

// ============================================
// Style Configuration
// ============================================

export const SIDEBAR_STYLE = {
  /** Top bar height */
  topBarHeight: WINDOW_CHROME_TOKENS.titleBarHeight,
  /** Shared navigation row height */
  rowHeight: 28,
} as const;

// ============================================
// Padding Configuration
// ============================================

export const SIDEBAR_PADDING = {
  /** Gap between sections (px) */
  sectionGap: 8,
} as const;
