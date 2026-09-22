/**
 * Shared frame classes for Kanban session creator and preview overlays.
 */
import { DETAIL_PANEL_TOKENS } from "@src/config/detailPanelTokens";

export const WORK_MANAGEMENT_SESSION_CREATOR_MAX_WIDTH_CLASS =
  DETAIL_PANEL_TOKENS.contentMaxWidth;

export const WORK_MANAGEMENT_SESSION_CREATOR_OVERLAY_CLASS =
  "pointer-events-none absolute inset-x-0 bottom-0 top-0 z-50 flex items-end bg-linear-to-t from-bg-1/90 via-bg-1/55 to-transparent px-2 pb-2 pt-12";

export const WORK_MANAGEMENT_SESSION_CREATOR_SURFACE_CLASS = `mx-auto w-full ${WORK_MANAGEMENT_SESSION_CREATOR_MAX_WIDTH_CLASS} pointer-events-auto`;

// The padding is the floating window's hard edge margin: `FloatingWindow`
// clamps drag/resize to the overlay's content box, so the preview (incl. the
// team-session replay loader) can never touch or cross a board edge.
export const WORK_MANAGEMENT_SESSION_PREVIEW_OVERLAY_CLASS =
  "pointer-events-none absolute inset-0 z-60 flex items-end p-3";

export const WORK_MANAGEMENT_SESSION_PREVIEW_SURFACE_CLASS = `pointer-events-auto mx-auto flex h-full max-h-[600px] w-full ${WORK_MANAGEMENT_SESSION_CREATOR_MAX_WIDTH_CLASS} flex-col overflow-hidden rounded-[12px] border border-border-2 bg-bg-2 shadow-2xl`;
