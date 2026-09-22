/** PR-style preview geometry. Spotlight and selection menus are separate surfaces. */
export const HOVER_CARD = {
  iconSize: 13,
  iconStrokeWidth: 1.75,
  compactIconSize: 12,
  feedbackStrokeWidth: 2,
  text: "text-[13px] leading-5",
  title:
    "mb-2 block max-w-full whitespace-normal break-words font-medium text-text-1",
  surface: "rounded-xl border border-border-2 bg-bg-2 p-3 shadow-dropdown",
  rows: "space-y-2",
  row: "grid grid-cols-[16px_minmax(0,1fr)] items-start gap-2 text-text-2",
  iconSlot: "mt-0.5 flex h-4 w-4 items-center justify-center",
  tags: "flex min-h-5 min-w-0 flex-wrap items-center gap-1",
} as const;
