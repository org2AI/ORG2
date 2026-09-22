/**
 * GlobalSpotlight Constants
 *
 * Centralized config for spotlight positioning and limits. All spotlight
 * chrome lives in SpotlightShell — constants here are the single source of
 * truth it reads from.
 */
import {
  SPOTLIGHT_TOP_OFFSET,
  SPOTLIGHT_WIDTH,
} from "@src/util/ui/spotlightAnchor";

export const SPOTLIGHT_CONFIG = {
  /** Width of the spotlight in pixels */
  width: SPOTLIGHT_WIDTH,
  /** Distance from top of viewport in pixels */
  topOffset: SPOTLIGHT_TOP_OFFSET,
  /** Z-index for backdrop overlay */
  backdropZIndex: 9998,
  /** Z-index for spotlight container */
  containerZIndex: 9999,
} as const;

// ============ TYPOGRAPHY TOKENS ============

export const SPOTLIGHT_TOKENS = {
  /** Input / pill text */
  inputFontSize: "text-[14px]",
  /** Primary item label */
  labelFontSize: "text-[14px]",
  /** Secondary / desc / subtitle text */
  subFontSize: "text-[11px]",
  /** Badge / tag text */
  badgeFontSize: "text-[10px]",
  /** Item row height (no desc) */
  itemHeight: 34,
  /** Item row height (with desc line) */
  itemHeightWithDesc: 48,
  /** List edge inset, matching the row horizontal margin (mx-2). */
  listInset: 8,
  /** Space after an option row (headers have no trailing gap). */
  itemGap: 3,
  /** Icon size inside item rows */
  iconSize: 16,
} as const;

export const SPOTLIGHT_CLASSES = {
  /** Shared option-row geometry and default typography, also used by launchpad. */
  itemRow: "flex items-center gap-2.5 rounded-lg px-2",
  itemIcon: "flex h-6 w-6 shrink-0 items-center justify-center",
  itemIconTone: "text-text-2",
  itemLabelWeight: "font-normal",
  itemLabelTone: "text-text-1",
  panel: "overflow-hidden rounded-2xl border border-border-2 bg-bg-2 shadow-xl",
  /** Primary contextual pill used by palette navigation and active state badges. */
  primaryPill:
    "flex items-center gap-1 rounded-full bg-primary-1 px-2.5 py-1 text-primary-6",
  /** Hover and press feedback only for pills that navigate back. */
  interactivePill:
    "cursor-pointer transition-colors duration-150 hover:bg-primary-2 hover:text-primary-7 active:bg-primary-3 motion-reduce:transition-none",
} as const;
