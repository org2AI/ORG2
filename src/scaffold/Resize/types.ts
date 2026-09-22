import type { MouseEvent, ReactNode } from "react";

/**
 * Resize Feature - Type Definitions
 */

/** Resize axis: x for horizontal, y for vertical */
export type ResizeAxis = "x" | "y";

/** Visual variant for resize handle default (resting) state */
type ResizeHandleVariant = "transparent" | "border";
type ResizeHandleIndicatorPlacement = "start" | "center" | "end";

export interface ResizeHandleProps {
  /** Resize axis */
  axis: ResizeAxis;
  /** Mouse down handler */
  onMouseDown: (event: MouseEvent) => void;
  /** Whether currently resizing */
  isResizing?: boolean;
  /** Resting-state appearance: "border" (visible 1px line, default) or "transparent" (invisible until hover) */
  variant?: ResizeHandleVariant;
  /** Use neutral border color instead of primary-6 for hover/active states */
  noAccent?: boolean;
  /** Right-click context menu handler */
  onContextMenu?: (event: MouseEvent) => void;
  /** Contextual action shown after hovering the handle for one second */
  tooltipLabel?: ReactNode;
  /** Keyboard shortcut displayed beside the contextual tooltip label */
  tooltipShortcut?: string;
  /**
   * Controls rendered under the tooltip label, turning the hint into a small
   * hover popover for the boundary the handle owns. Providing this makes the
   * tooltip panel pointer-reachable; `close` dismisses it after a pick, since
   * acting on the control usually moves the handle out from under the cursor.
   */
  renderTooltipExtra?: (close: () => void) => ReactNode;
  /** Side of the divider into which the thicker center indicator extends */
  indicatorPlacement?: ResizeHandleIndicatorPlacement;
  /** Optional unclipped layout-boundary host for the visual indicator */
  indicatorHost?: HTMLElement | null;
  /** Additional class name */
  className?: string;
}
