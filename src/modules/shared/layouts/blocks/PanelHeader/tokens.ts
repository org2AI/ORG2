/** Standard sizes and button props for PanelHeader elements */
export const PANEL_HEADER_TOKENS = {
  /**
   * Header row layout for custom panel headers (when not using PanelHeader component).
   * Matches the 40px row used by PanelHeader: flex, px-3 (no border — add `border-b border-border-2` if needed).
   */
  row: "flex h-10 shrink-0 items-center gap-2 px-3",

  /** Icon size for title icons (breadcrumb, title prefix) */
  iconSize: 14,
  /** Icon size inside action buttons (slightly larger for tap target) */
  buttonIconSize: 16,
  /** Stroke width for glyph icons in panel header buttons */
  iconStrokeWidth: 1.75,
  /** Font size for title text */
  fontSize: 13,
  /** Header height */
  height: 40,
  /** TabPill size for header-level pill toggles — always small in 40px headers */
  tabPillSize: "small" as const,

  /**
   * Standard props for ALL icon-only action buttons in 40px headers.
   * 24×24 circle, 16px icon, hover shows fill-2 background.
   * Spread on `<Button>`, add `icon`, `onClick`, `title`.
   */
  actionButton: {
    variant: "tertiary" as const,
    size: "mini" as const,
    shape: "circle" as const,
    iconOnly: true as const,
    className: "hover:bg-fill-2!",
  },

  /**
   * Pill-shaped action button (32×24) for dropdown triggers.
   * Use instead of actionButton when the control opens a dropdown (e.g. Add + chevron).
   */
  actionButtonPill: {
    variant: "tertiary" as const,
    size: "mini" as const,
    shape: "round" as const,
    iconOnly: true as const,
    className: "hover:bg-fill-2! h-6! w-9! min-w-9!",
  },

  /**
   * Props for danger action buttons (delete, close).
   * 24×24 circle, 16px icon, hover shows danger-1 background with danger-6 text.
   */
  dangerButton: {
    variant: "tertiary" as const,
    size: "mini" as const,
    shape: "circle" as const,
    iconOnly: true as const,
    className: "hover:bg-danger-1! hover:text-danger-6!",
  },

  /**
   * Vertical rule between header controls (same as FileHeader tab | actions separator).
   */
  verticalSeparator: "h-4 w-px shrink-0 bg-border-2",
} as const;
