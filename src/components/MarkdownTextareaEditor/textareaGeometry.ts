/** Anchor point for mention / slash dropdowns: just inside the textarea's bottom-left. */
export function cursorPosition(textarea: HTMLTextAreaElement): {
  x: number;
  y: number;
} {
  const rect = textarea.getBoundingClientRect();
  return { x: rect.left + 8, y: rect.bottom };
}

/** Text offset under a client point, when the browser can resolve one inside the textarea. */
export function textOffsetAtPoint(
  textarea: HTMLTextAreaElement,
  clientX?: number,
  clientY?: number
): number | null {
  if (clientX === undefined || clientY === undefined) return null;
  const ownerDocument = textarea.ownerDocument as Document & {
    caretPositionFromPoint?: (
      x: number,
      y: number
    ) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const position = ownerDocument.caretPositionFromPoint?.(clientX, clientY);
  if (position?.offsetNode === textarea) return position.offset;
  const range = ownerDocument.caretRangeFromPoint?.(clientX, clientY);
  if (range?.startContainer === textarea) return range.startOffset;
  return null;
}
