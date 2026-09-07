/** A secondary pane clears its parent panel, then falls below on narrow windows. */
export function getSidePanePlacement(
  anchor: Pick<DOMRect, "top" | "right" | "bottom" | "left">,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  panel: Pick<DOMRect, "right" | "bottom" | "left"> = anchor
) {
  const padding = 8;
  const gap = 8;
  const fitsRight = panel.right + gap + size.width <= viewport.width - padding;
  const top = fitsRight
    ? Math.max(
        padding,
        Math.min(anchor.top, viewport.height - size.height - padding)
      )
    : panel.bottom + gap;
  const maxHeight = Math.max(0, viewport.height - top - padding);
  return {
    width: "max-content" as const,
    top,
    left: fitsRight
      ? panel.right + gap
      : Math.max(
          padding,
          Math.min(
            (panel.left + panel.right - size.width) / 2,
            viewport.width - size.width - padding
          )
        ),
    maxHeight,
    maxWidth: Math.max(0, viewport.width - padding * 2),
    overflowY: "auto" as const,
  };
}
