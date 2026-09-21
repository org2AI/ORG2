import type { CSSProperties } from "react";

import { STYLE_CONFIG } from "./config";

interface CodeBlockBodyStyleOptions {
  contentHeight: number;
  isCollapsed: boolean;
  isExpanded: boolean;
  isLoading: boolean;
  needsExpand: boolean;
  useTerminalLayout: boolean;
  visibleLines?: number;
}

/**
 * Inline style of the code body wrapper: none for the terminal layout, a
 * self-scrolling window while streaming, otherwise the clamped preview or the
 * 40vh expanded viewport.
 */
export function getCodeBlockBodyStyle({
  contentHeight,
  isCollapsed,
  isExpanded,
  isLoading,
  needsExpand,
  useTerminalLayout,
  visibleLines,
}: CodeBlockBodyStyleOptions): CSSProperties | undefined {
  return useTerminalLayout
    ? undefined
    : isLoading
      ? {
          maxHeight: (visibleLines ?? 15) * 18 + 16,
          overflowY: "auto",
          overflowX: "hidden",
          transition: `opacity ${STYLE_CONFIG.animationDuration}ms ease-out`,
        }
      : {
          opacity: isCollapsed ? 0 : 1,
          overflow: isExpanded && needsExpand ? undefined : "hidden",
          maxHeight:
            isExpanded && needsExpand
              ? "40vh"
              : needsExpand
                ? contentHeight
                : undefined,
          overflowY: isExpanded && needsExpand ? "auto" : undefined,
          overflowX: isExpanded && needsExpand ? "hidden" : undefined,
          transition: `opacity ${STYLE_CONFIG.animationDuration}ms ease-out`,
        };
}
