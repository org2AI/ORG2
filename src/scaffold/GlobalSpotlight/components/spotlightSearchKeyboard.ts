/// <reference lib="es2022.intl" />
import type { KeyboardEvent } from "react";

/** Own horizontal navigation before palette handlers or WebKit text insertion. */
export function handleSpotlightHorizontalArrow(
  event: KeyboardEvent<HTMLInputElement>
): boolean {
  const left = event.key === "ArrowLeft" || event.key === "\uF702";
  const right = event.key === "ArrowRight" || event.key === "\uF703";
  if (!left && !right) return false;
  // The IME owns candidate navigation during composition.
  if (event.nativeEvent.isComposing) return true;
  if (event.defaultPrevented) return true;

  const input = event.currentTarget;
  const start = input.selectionStart;
  const end = input.selectionEnd;
  if (start === null || end === null) return false;

  // Prevent the native arrow function-key characters from becoming query text.
  event.preventDefault();
  event.stopPropagation();
  const backward = input.selectionDirection === "backward";
  const anchor = backward ? end : start;
  const cursor = backward ? start : end;
  let next: number;
  if (event.metaKey) {
    next = left ? 0 : input.value.length;
  } else if (event.altKey || event.ctrlKey) {
    const words = Array.from(
      new Intl.Segmenter(undefined, { granularity: "word" }).segment(
        input.value
      )
    ).filter((segment) => segment.isWordLike);
    next = left
      ? (words.filter((word) => word.index < cursor).at(-1)?.index ?? 0)
      : (words
          .map((word) => word.index + word.segment.length)
          .find((boundary) => boundary > cursor) ?? input.value.length);
  } else if (!event.shiftKey && start !== end) {
    next = left ? start : end;
  } else {
    const boundaries = [
      ...Array.from(
        new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
          input.value
        ),
        (segment) => segment.index
      ),
      input.value.length,
    ];
    next = left
      ? (boundaries.filter((boundary) => boundary < cursor).at(-1) ?? 0)
      : (boundaries.find((boundary) => boundary > cursor) ??
        input.value.length);
  }
  if (event.shiftKey) {
    input.setSelectionRange(
      Math.min(anchor, next),
      Math.max(anchor, next),
      next < anchor ? "backward" : "forward"
    );
  } else {
    input.setSelectionRange(next, next);
  }
  return true;
}
