/**
 * WorkStation Header Tokens
 *
 * Centralized header dimensions, button styles, and class strings for Workstation.
 * Follows the same pattern as DROPDOWN_CLASSES in @src/components/Dropdown/tokens.
 */
import { SURFACE_TOKENS } from "@src/config/surfaceTokens";

/** Orgii Editor tab canvas — matches CodeMirror (--cm-editor-background on :root). */
export const EDITOR_TAB_CANVAS_BG_CLASS = "bg-(--cm-editor-background)";

/** Primary sidebar panel background — follows the host's editor/pane surface. */
export const PRIMARY_SIDEBAR_SURFACE_BG_CLASS = EDITOR_TAB_CANVAS_BG_CLASS;

/** Full-area empty / loading surfaces inherit the host's primary pane paint. */
export const WORK_STATION_PLACEHOLDER_PAGE_BG_CLASS =
  EDITOR_TAB_CANVAS_BG_CLASS;

/**
 * Shared geometry for compact content inside floating Workstation trails.
 * Keep entity/property trails on these classes so row height, insets, and
 * section rhythm cannot drift from the focused-chat environment trail.
 */
const WORKSTATION_TRAIL_ROW_HORIZONTAL_PADDING = "pl-2 pr-1.5";
export const WORKSTATION_TRAIL_SECTION_LABEL =
  "text-left text-[11px] font-medium uppercase tracking-wide text-text-3";

export const WORKSTATION_TRAIL_CONTENT = {
  sectionList: "space-y-3",
  section: "space-y-1",
  sectionLabel: `px-2 ${WORKSTATION_TRAIL_SECTION_LABEL}`,
  sectionLabelInline: `pl-2 pr-1 ${WORKSTATION_TRAIL_SECTION_LABEL}`,
  rows: "space-y-1",
  row: "flex h-7 min-w-0 items-center rounded-lg",
  rowHorizontalPadding: WORKSTATION_TRAIL_ROW_HORIZONTAL_PADDING,
  rowContent: `flex h-full min-w-0 flex-1 items-center gap-1.5 ${WORKSTATION_TRAIL_ROW_HORIZONTAL_PADDING} text-left text-[12px]`,
} as const;

export const PRIMARY_SIDEBAR_HOVER = {
  row: SURFACE_TOKENS.hover,
  selectedRow: SURFACE_TOKENS.selectedHover,
} as const;

// ============================================
// Dimensions
// ============================================

/** Icon sizes used inside header buttons */
export const HEADER_ICON_SIZE = {
  /** Compact discard glyph; button hit area stays unchanged. */
  discard: 12,
  /** Standard icon size (14px) — section headers, file headers, action bars */
  sm: 14,
  /** Larger icon size (16px) — bottom panel, URL bar, tab bar */
  md: 16,
} as const;

// ============================================
// Button Tokens
// ============================================

/** Shared icon-button geometry; callers own display/hover-reveal behavior. */
export const ICON_BUTTON_BASE =
  "shrink-0 items-center justify-center transition-colors";
const BUTTON_BASE = `flex ${ICON_BUTTON_BASE}`;

/** Size and radius classes for icon-only buttons */
export const BUTTON_SIZE = {
  /** 20×20 — standard header / row action button (single source of truth) */
  sm: "h-5 w-5 rounded-sm",
  /** 24×24 — larger header action button */
  md: "h-6 w-6 rounded-lg",
  /** 28×28 — collapse toggles, modal headers */
  lg: "h-7 w-7 rounded-lg",
} as const;

/**
 * One palette for compact row, terminal, and header actions on controls that
 * cannot use `Button`. Button keeps a `btn:`-layered copy of these in
 * src/components/Button/presentation.tsx (parity is tested).
 */
const DEFAULT_BUTTON_VARIANT =
  "text-text-2 enabled:hover:bg-fill-2 enabled:hover:text-text-1 focus-visible:bg-fill-2 focus-visible:text-text-1";

export const BUTTON_VARIANT = {
  default: DEFAULT_BUTTON_VARIANT,
  noDrop:
    "text-text-2 enabled:hover:bg-button-hover-no-drop enabled:hover:text-text-1 focus-visible:bg-button-hover-no-drop focus-visible:text-text-1",
  defaultTreeRow: DEFAULT_BUTTON_VARIANT,
  danger:
    "text-danger-6 enabled:hover:bg-danger-2 enabled:hover:text-danger-6 focus-visible:bg-danger-2 focus-visible:text-danger-6",
  dangerNoDrop:
    "text-danger-6 enabled:hover:bg-danger-1 enabled:hover:text-danger-6 focus-visible:bg-danger-1 focus-visible:text-danger-6",
  primary:
    "text-text-2 enabled:hover:bg-primary-3 enabled:hover:text-primary-6 focus-visible:bg-primary-3 focus-visible:text-primary-6",
  success:
    "text-success-6 enabled:hover:bg-success-3 focus-visible:bg-success-3",
  active:
    "bg-surface-selected text-primary-6 enabled:hover:bg-button-hover focus-visible:bg-button-hover",
} as const;

/** Pre-composed class strings for icon controls that cannot use `Button`. */
export const HEADER_BUTTON = {
  /** Standard action button (20×20, default variant) */
  action: `flex ${ICON_BUTTON_BASE} ${BUTTON_SIZE.sm} ${BUTTON_VARIANT.default}`,
  /** Medium row action — uses the same default palette. */
  actionMdTreeRow: `${BUTTON_BASE} ${BUTTON_SIZE.md} ${BUTTON_VARIANT.defaultTreeRow}`,
} as const;

// ============================================
// Tab bar trailing strip (document tabs row)
// ============================================

/** Horizontal inset of the tab bar's right-side control row. */
export const TAB_BAR_CONTROLS_ROW_PADDING_FULL = "pl-1 pr-2";

/**
 * The `pr-2` above, in pixels. Hosts that reserve window-edge space for
 * pinned chrome subtract it so the reservation's 1px gap is not doubled.
 */
export const TAB_BAR_CONTROLS_ROW_TRAILING_PADDING_PX = 8;

/**
 * Trailing icon group inside the tab bar's control row (or inside
 * {@link TAB_BAR_TRAILING_EDGE_CLASS}). Do not add horizontal padding here —
 * the parent supplies the tab-bar edge inset.
 */
export const TAB_BAR_TRAILING_CLUSTER_CLASS =
  "flex h-full shrink-0 items-center gap-px";

/**
 * Trailing block at the end of a tab bar **without** `TabBarControls` (e.g.
 * {@link ReplayTabBar}) — matches the controls row’s horizontal padding only.
 */
export const TAB_BAR_TRAILING_EDGE_CLASS =
  "flex h-full shrink-0 items-center gap-px pl-1 pr-2";

// ============================================
// Header Class Strings
// ============================================

/** Shared left inset aligning header content with the first tab icon. */
export const HEADER_CONTENT_LEFT_PADDING_CLASS = "pl-[15px]";
/** Shared right inset for content inside My Station header bars. */
const HEADER_CONTENT_RIGHT_PADDING_CLASS = "pr-2";
/** Shared tab-aligned left and compact right insets for header bars. */
const HEADER_CONTENT_HORIZONTAL_PADDING_CLASS = `${HEADER_CONTENT_LEFT_PADDING_CLASS} ${HEADER_CONTENT_RIGHT_PADDING_CLASS}`;

/** Shared 36px file-bar row geometry (used by FileHeader + search rows). */
export const FILE_BAR_ROW_CLASSES = `work-station-file-bar flex h-9 shrink-0 items-center gap-1.5 ${HEADER_CONTENT_HORIZONTAL_PADDING_CLASS}`;

export const HEADER_CLASSES = {
  /**
   * File bar header (top bar showing file path / URL / preview info).
   * Used by: FileHeader, WebUrlBar
   *
   * Height: 36px, horizontal layout, shrink-proof, tab-aligned left inset.
   */
  fileBar: FILE_BAR_ROW_CLASSES,

  /**
   * Page-level header (bordered, with background).
   * Used by: ProjectsPageHeader, WorkItemsPageHeader
   *
   * Height: 36px, bottom border, tab-aligned left inset.
   */
  pageHeader: `flex h-9 shrink-0 items-center gap-2 border-b border-border-2 ${HEADER_CONTENT_HORIZONTAL_PADDING_CLASS}`,

  /**
   * Section title header (inline title for property groups, no border/bg).
   * Used by: PropertiesPanel, WorkItemProperties, WorkItemsOverview
   *
   * Height: 40px, transparent background, 12px horizontal padding.
   */
  sectionTitle: "flex h-[40px] shrink-0 items-center gap-2 px-4",

  /**
   * Sidebar section header (collapsible section title row).
   *
   * Height: 32px, space-between layout, shrink-proof, transparent surface.
   */
  sectionHeader:
    "flex h-8 min-w-0 shrink-0 items-center justify-between overflow-hidden bg-transparent pl-3 pr-2",
} as const;

// ============================================
// Typography Tokens
// ============================================
// Matches UI Design Standards (ui-design-standards-0106.md)

export const TYPOGRAPHY = {
  /** Section titles, panel headers — 13px medium */
  sectionTitle: "text-[13px] font-medium",
  /** Field labels, property names — 12px normal */
  label: "text-[12px] font-normal",
  /** Field values, body content — 12px normal */
  value: "text-[12px] font-normal",
  /** Emphasized values — 12px medium */
  valueMedium: "text-[12px] font-medium",
  /** Numeric stats, card numbers — 14px semibold */
  statistic: "text-[14px] font-semibold",
  /** Helper text, timestamps, badges — 11px normal */
  secondary: "text-[11px] font-normal",
  /** Panel placeholders (sidebar) — 12px normal */
  panelTitle: "text-[12px]",
  /** Panel subtitle — 11px */
  panelSubtitle: "text-[11px]",
  /** Content placeholders (main area) — 14px bold */
  contentTitle: "text-[14px] font-medium",
  /** Content subtitle — 12px */
  contentSubtitle: "text-[12px]",
  /** List items, row labels — 13px medium */
  listItem: "text-[13px] font-medium",
  /** Small badges, counts — 10px medium */
  badge: "text-[10px] font-medium",
} as const;

// ============================================
// Count Badge Tokens
// ============================================
/** Used by: SectionHeader (source control), SearchResults (file match count) */

export const COUNT_BADGE = {
  /** Base: flex, centered, rounded-full, 18px height, 11px font */
  base: "flex h-[18px] shrink-0 items-center justify-center rounded-full text-[11px] font-medium",
  /** Single digit (0–9): 18×18 square */
  sizeSingle: "w-[18px]",
  /** Multi digit (10+): min width with padding */
  sizeMulti: "min-w-[18px] px-1.5",
  /** Primary variant (source control, search) */
  primary: "bg-primary-5 text-white",
  /** Muted variant for zero-count section badges */
  muted: "bg-fill-2 text-text-3",
  /** Warning variant (merge conflicts) */
  warning: "bg-warning-5 text-white",
  /** Danger variant (merge conflicts, destructive counts) */
  danger: "bg-danger-5 text-white",
} as const;

/** Returns size class for count badge (18×18 for single digit, expandable for multi) */
export function getCountBadgeSizeClass(count: number): string {
  return count < 10 ? COUNT_BADGE.sizeSingle : COUNT_BADGE.sizeMulti;
}

// ============================================
// Diff Stats Tokens
// ============================================
/** +N / -N inline stats shown in file headers and commit headers */

export const DIFF_STATS = {
  /** Container: inline flex, shrink-proof, 12px, padded for header context */
  container:
    "flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[12px]",
  /** Compact variant for tree rows (11px, no padding) */
  containerCompact: "flex shrink-0 items-center gap-1 text-[11px]",
  /** Additions text */
  additions: "text-success-6",
  /** Deletions text */
  deletions: "text-danger-6",
} as const;

// ============================================
// Multi-Root Folder Header Tokens
// ============================================

export const FOLDER_HEADER = {
  /** Outer wrapper for a folder section */
  section: "flex flex-col",
  /** Branch name text */
  branch: "min-w-0 truncate text-[11px] text-text-3",
} as const;
