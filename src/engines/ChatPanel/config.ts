/**
 * ChatPanel Configuration Constants
 */

// CSS variable for chat width
export const CHAT_WIDTH_CSS_VAR = "--orgii-chat-width";

// Width written only while the divider is dragged, on the elements that size
// the pane. Registered non-inherited in index.scss: a per-frame write to the
// inherited root variable restyles every element in the app.
export const CHAT_LIVE_WIDTH_CSS_VAR = "--orgii-chat-live-width";
export const CHAT_WIDTH_STYLE_VALUE = `var(${CHAT_LIVE_WIDTH_CSS_VAR}, var(${CHAT_WIDTH_CSS_VAR}))`;

// Resize constraints
export const MIN_WIDTH = 420;
export const CHAT_PANEL_LAYOUT_GUTTER = 20;

/**
 * Sidebar width assumed before the real content area has been measured.
 *
 * Matches `DEFAULT_SIDEBAR_WIDTH` in `store/ui/sidebarAtom`, duplicated rather
 * than imported so this module stays a leaf with no store dependencies. It is
 * only a seed: `setChatSplitAreaWidth` replaces the estimate with the measured
 * width on the first layout pass.
 */
const ASSUMED_SIDEBAR_WIDTH = 240;

/**
 * Width the station and the chat pane actually divide between them.
 *
 * Measured, not derived from the viewport: the navigation sidebar is
 * resizable (200–320px) and collapses to 0, so no constant describes it. The
 * previous `viewport - 64 - gutter` estimate was wrong in every state — with
 * the sidebar open it overstated the shared area by ~176px, so a "1/2" preset
 * handed the chat pane closer to 57% of it. `AppLayout` observes the element
 * that holds the station and the chat pane (a sibling of the sidebar, so its
 * width already accounts for whatever the sidebar is doing) and publishes it
 * here.
 */
let measuredSplitAreaWidth = 0;

/** Publish the measured station+chat area. Non-positive values clear it. */
export function setChatSplitAreaWidth(width: number): void {
  measuredSplitAreaWidth = Number.isFinite(width) && width > 0 ? width : 0;
}

/**
 * Presets for `general.chatPaneSplitRatio` — the share of the workbench the
 * chat pane takes, with the station (My Station / Agent Station) keeping the
 * rest. The preset is a *default*, not a constraint: it seeds the width on
 * first run and is re-applied the moment the user picks one, after which the
 * divider can still be dragged to any width in [MIN_WIDTH, getChatMaxWidth()].
 */
export const CHAT_SPLIT_RATIOS = {
  "one-third": 1 / 3,
  half: 1 / 2,
  "two-thirds": 2 / 3,
} as const;

export type ChatSplitRatio = keyof typeof CHAT_SPLIT_RATIOS;

/** Menu order, narrowest chat pane first. */
export const CHAT_SPLIT_RATIO_VALUES = [
  "one-third",
  "half",
  "two-thirds",
] as const satisfies readonly ChatSplitRatio[];

/**
 * Fraction glyphs, used as the segmented-control labels. Digits and a solidus
 * read the same in every locale, so these are not translated.
 */
export const CHAT_SPLIT_RATIO_LABELS: Record<ChatSplitRatio, string> = {
  "one-third": "1/3",
  half: "1/2",
  "two-thirds": "2/3",
};

/**
 * Nearest preset to the historical fixed 520px default. On a typical window
 * that width sat near 0.38 of the available space, between `one-third` and
 * `half` but closer to the former, so a fresh install lands a little narrower
 * than the old fixed default rather than jumping to an even split.
 */
export const DEFAULT_CHAT_SPLIT_RATIO: ChatSplitRatio = "one-third";

/** The drag ceiling is the widest preset, so every preset stays reachable. */
export const MAX_WIDTH_RATIO = CHAT_SPLIT_RATIOS["two-thirds"];

/**
 * Width the station and the chat pane divide between them.
 *
 * An explicit `viewportWidth` means "compute for this window" (the pane's own
 * responsive clamp, and tests), so it bypasses the measurement; otherwise a
 * measured area wins over the estimate.
 */
function getChatAvailableWidth(viewportWidth?: number): number {
  if (viewportWidth === undefined && measuredSplitAreaWidth > 0) {
    return Math.max(MIN_WIDTH, measuredSplitAreaWidth);
  }
  const width =
    viewportWidth ??
    (typeof window !== "undefined" ? window.innerWidth : MIN_WIDTH * 2);
  return Math.max(
    MIN_WIDTH,
    width - ASSUMED_SIDEBAR_WIDTH - CHAT_PANEL_LAYOUT_GUTTER
  );
}

export function getChatMaxWidth(viewportWidth?: number): number {
  return Math.max(
    MIN_WIDTH,
    Math.floor(getChatAvailableWidth(viewportWidth) * MAX_WIDTH_RATIO)
  );
}

/**
 * The pane width a preset asks for, clamped to the resize constraints.
 *
 * Floors like `getChatMaxWidth` rather than rounding: the ceiling *is* the
 * widest preset, so rounding up half a pixel left that preset permanently
 * clamped one pixel short of itself.
 */
export function getChatWidthForRatio(
  ratio: ChatSplitRatio,
  viewportWidth?: number
): number {
  return clampVisibleChatWidth(
    Math.floor(getChatAvailableWidth(viewportWidth) * CHAT_SPLIT_RATIOS[ratio]),
    viewportWidth
  );
}

export function clampVisibleChatWidth(
  value: number,
  viewportWidth?: number
): number {
  return Math.min(Math.max(value, MIN_WIDTH), getChatMaxWidth(viewportWidth));
}

export function clampChatWidth(value: number, viewportWidth?: number): number {
  return value > 0 ? clampVisibleChatWidth(value, viewportWidth) : value;
}

// Timing constants
export const RAPID_CLICK_THRESHOLD_MS = 300;
