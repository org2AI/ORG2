/**
 * Sidebar Configuration
 *
 * Centralized configuration for sidebar styling and behavior.
 */
import { CHROME_TOOLTIP_HOVER_DELAY } from "@src/config/tooltip";
import { WINDOW_CHROME_TOKENS } from "@src/config/windowChromeTokens";

/** Hover dwell time before showing a sidebar control tooltip. */
export const SIDEBAR_TOOLTIP_HOVER_DELAY = CHROME_TOOLTIP_HOVER_DELAY;

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
