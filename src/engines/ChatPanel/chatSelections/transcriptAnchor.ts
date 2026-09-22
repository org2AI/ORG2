/**
 * Resolve the transcript anchor a DOM selection sits in.
 *
 * Chat groups carry `data-transcript-anchor-id` for the virtualizer's
 * reveal path. Recording it at pin time keeps a pinned passage tied to the
 * turn it came from.
 */

export function resolveTranscriptAnchorId(
  node: Node | null | undefined
): string | undefined {
  const element =
    node instanceof Element ? node : (node?.parentElement ?? null);
  const anchor = element?.closest<HTMLElement>("[data-transcript-anchor-id]");
  return anchor?.getAttribute("data-transcript-anchor-id") ?? undefined;
}

/** Anchor of the live DOM selection, if it is inside an anchored group. */
export function resolveSelectionAnchorId(
  selection: Selection | null
): string | undefined {
  if (!selection || selection.rangeCount === 0) return undefined;
  return resolveTranscriptAnchorId(
    selection.getRangeAt(0).commonAncestorContainer
  );
}
