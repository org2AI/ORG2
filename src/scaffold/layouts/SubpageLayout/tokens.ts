/**
 * Subpage layout spacing tokens.
 *
 * Shared by Settings main content and Project Manager subpages to keep
 * visual rhythm consistent (padding, max-width, section gaps, bottom breathing room).
 */
import { DETAIL_PANEL_TOKENS } from "@src/components/layout/blocks";

import type { SplitViewLayoutProps } from "../SplitViewLayout";

export const SUBPAGE_CONTENT_WRAPPER_CLASSES = `${DETAIL_PANEL_TOKENS.contentWidth} flex flex-col gap-10 py-6 pb-[25vh]`;

/** SplitViewLayout geometry shared by the Project Manager settings subpages. */
export const SUBPAGE_SPLIT_VIEW_PRESET = {
  className: "min-h-0 flex-1 overflow-hidden",
  hideBreadcrumbWhenSidebarCollapsed: true,
  mainContentClassName: "",
  listPanelBackgroundClassName: "",
  listWidth: 180,
  minListWidth: 140,
  maxListWidth: 240,
} as const satisfies Partial<SplitViewLayoutProps>;
