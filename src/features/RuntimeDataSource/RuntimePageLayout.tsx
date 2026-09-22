/**
 * The one container contract every Runtime page uses: shell → header track →
 * scroll region → content column.
 *
 * Each Runtime surface used to spell its own out, and they drifted: the
 * builder-types gallery centred its content on the 932px SHELL track without
 * the 16px gutter, so its cards ran 32px wider than every other tab while its
 * own header stayed on the 900px content measure.
 *
 * The fix is one track for header and body alike. `RUNTIME_PAGE_TRACK` is the
 * padded 932px shell — 900px of content between two 16px gutters — so a header
 * pinned above the scroll region and the content scrolling under it share an
 * edge, and a child that bleeds with `-mx-4` reaches the same place on every
 * page. Gutters belong to this track, never to the scroll region: padding on
 * the scroller sits outside the centred column and pulls narrow panes out of
 * alignment with their header.
 */
import type { ReactNode } from "react";

import { SECTION_GAP_CLASSES } from "@src/components/layout/Section";
import { DETAIL_PANEL_TOKENS } from "@src/config/detailPanelTokens";

/** Full-height column: a pinned header above a scroll region that fills it. */
export const RUNTIME_PAGE_SHELL = "flex h-full min-h-0 flex-col";

/** Centred 932px shell with the page's 16px gutters — headers and body alike. */
export const RUNTIME_PAGE_TRACK = `${DETAIL_PANEL_TOKENS.headerWidth} px-4`;

/** The scroll region itself. Carries no gutters; the track inside it does. */
export const RUNTIME_PAGE_SCROLL =
  "@container scrollbar-hide min-h-0 flex-1 overflow-y-auto";

/**
 * The content column inside the scroll region: the page track, the standard
 * gap between sections, and the tall bottom affordance that lets the last
 * section scroll up to a comfortable reading position.
 *
 * The top inset is that same section gap. A page header is a sibling of this
 * column — pinned above the scroll region, or scrolling inside it — so the
 * flex gap never reaches it, and without the inset the first section butts
 * straight up against the header.
 */
export const RUNTIME_PAGE_BODY = `${RUNTIME_PAGE_TRACK} ${SECTION_GAP_CLASSES} pt-3 pb-[25vh]`;

interface RuntimePageBodyProps {
  children?: ReactNode;
  /** Extra classes for the column — never gutters or a width. */
  className?: string;
  dataTestId?: string;
}

/** The content column of a Runtime page, on the shared track. */
export function RuntimePageBody({
  children,
  className,
  dataTestId,
}: RuntimePageBodyProps) {
  return (
    <div
      className={`${RUNTIME_PAGE_BODY}${className ? ` ${className}` : ""}`}
      data-testid={dataTestId}
    >
      {children}
    </div>
  );
}
