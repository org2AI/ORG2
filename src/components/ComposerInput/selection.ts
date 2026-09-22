/**
 * Selection helpers for the contenteditable host.
 *
 * Pill spans are `contenteditable="false"`, so the browser already treats
 * the entire pill as a single navigation unit. The only piece we have to
 * handle ourselves is *programmatically* placing the caret — after
 * inserting a pill, after `setContent`, after `clear`, etc.
 */
import {
  PILL_DATA_ATTR,
  extractPlainText,
  plainTextLength,
  rawIndexAtPlainOffset,
} from "./utils";

/** Move a caret atomically, without temporarily leaving the editor unselected. */
function applyCaretRange(range: Range): void {
  const selection = window.getSelection();
  if (!selection) return;
  // Always collapse, even when the selection already reports this node and
  // offset. After a "\n" is inserted, WebKit reports the caret there while
  // its visual position still has upstream affinity — the end of the previous
  // line — so skipping the collapse left text typed after Enter landing on the
  // line above. Re-collapsing to the same point resets it and is otherwise a
  // no-op.
  // removeAllRanges/addRange introduces an intermediate empty selection.
  // collapse replaces the caret in one operation and preserves focus ownership.
  selection.collapse(range.startContainer, range.startOffset);
}

/** Place the caret at the end of the contenteditable host. */
export function placeCaretAtEnd(host: HTMLElement): void {
  if (document.activeElement !== host) host.focus();
  const range = document.createRange();
  // Keep the caret in editable text after an atomic first pill. A host-level
  // boundary can be normalized to the pill's leading edge by WebKit.
  const lastChild = host.lastChild;
  if (lastChild?.nodeType === Node.TEXT_NODE) {
    range.setStart(lastChild, (lastChild.textContent ?? "").length);
    range.collapse(true);
  } else {
    range.selectNodeContents(host);
    range.collapse(false);
  }
  applyCaretRange(range);
}

/** Place the caret immediately after the given DOM node. */
export function placeCaretAfter(node: Node): void {
  const range = document.createRange();
  if (node.nodeType === Node.TEXT_NODE) {
    range.setStart(node, (node.textContent ?? "").length);
  } else {
    const parent = node.parentNode;
    if (parent) {
      const childIndex = Array.prototype.indexOf.call(parent.childNodes, node);
      range.setStart(parent, childIndex + 1);
    } else {
      range.setStartAfter(node);
    }
  }
  range.collapse(true);
  applyCaretRange(range);
}

/**
 * Return the currently active Range *if* it lives inside `host`. Otherwise
 * return a synthetic range positioned at the end of `host` so callers can
 * safely insert content even when the editor was never focused.
 */
function fallbackEndRange(host: HTMLElement): Range {
  const fallback = document.createRange();
  fallback.selectNodeContents(host);
  fallback.collapse(false);
  return fallback;
}

function selectionRangeInsideHost(host: HTMLElement): Range | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  if (
    host.contains(range.startContainer) &&
    host.contains(range.endContainer)
  ) {
    return range.cloneRange();
  }

  return null;
}

export function rangeInsideHost(host: HTMLElement): Range {
  return selectionRangeInsideHost(host) ?? fallbackEndRange(host);
}

function focusedRangeInsideHost(host: HTMLElement): Range {
  const activeElement = document.activeElement;
  const editorHasFocus = activeElement === host || host.contains(activeElement);
  if (!editorHasFocus) return fallbackEndRange(host);
  return selectionRangeInsideHost(host) ?? fallbackEndRange(host);
}

function getCaretRangeFromPoint(x: number, y: number): Range | null {
  if (document.caretRangeFromPoint) {
    return document.caretRangeFromPoint(x, y);
  }

  if (document.caretPositionFromPoint) {
    const position = document.caretPositionFromPoint(x, y);
    if (!position) return null;
    const range = document.createRange();
    range.setStart(position.offsetNode, position.offset);
    range.collapse(true);
    return range;
  }

  return null;
}

/**
 * Place the caret at `targetOffset`, measured in plain-text coordinates — the
 * same ones `caretTextOffset` and `extractPlainText` use, so an offset read
 * from one can be handed to the other.
 */
export function placeCaretAtTextOffset(
  host: HTMLElement,
  targetOffset: number
): void {
  host.focus();
  const range = document.createRange();
  let remaining = Math.max(0, targetOffset);

  const placeAtEnd = () => {
    range.selectNodeContents(host);
    range.collapse(false);
  };

  const visit = (node: Node): boolean => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      const length = plainTextLength(text);
      if (remaining <= length) {
        range.setStart(node, rawIndexAtPlainOffset(text, remaining));
        range.collapse(true);
        return true;
      }
      remaining -= length;
      return false;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    const element = node as HTMLElement;
    if (element.tagName === "BR") {
      if (remaining <= 0) {
        range.setStartBefore(element);
        range.collapse(true);
        return true;
      }
      // The position after a line break is the start of whatever follows it,
      // so keep walking: that lands the caret in the next line's text.
      remaining -= 1;
      return false;
    }

    if (element.getAttribute(PILL_DATA_ATTR) === "true") {
      // A pill counts as its full name. Its rendered label is truncated, and
      // is empty until the portal paints, so it cannot be measured here.
      const textLength = (element.getAttribute("data-file-name") ?? "").length;
      if (remaining <= 0) {
        range.setStartBefore(element);
        range.collapse(true);
        return true;
      }
      if (remaining <= textLength) {
        range.setStartAfter(element);
        range.collapse(true);
        return true;
      }
      remaining -= textLength;
      return false;
    }

    for (const child of Array.from(element.childNodes)) {
      if (visit(child)) return true;
    }
    return false;
  };

  for (const child of Array.from(host.childNodes)) {
    if (visit(child)) {
      const selection = window.getSelection();
      if (!selection) return;
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
  }

  placeAtEnd();
  const selection = window.getSelection();
  if (!selection) return;
  selection.removeAllRanges();
  selection.addRange(range);
}

export function placeCaretAfterPill(pill: HTMLElement): void {
  const host = pill.closest<HTMLElement>('[contenteditable="true"]');
  if (host && document.activeElement !== host) {
    host.focus({ preventScroll: true });
  }

  // Empty text nodes are left behind wherever a range split one; look past
  // them for what really follows the pill.
  let following: Node | null = pill.nextSibling;
  while (
    following?.nodeType === Node.TEXT_NODE &&
    (following.textContent ?? "").length === 0 &&
    following.nextSibling
  ) {
    following = following.nextSibling;
  }

  const range = document.createRange();
  if (following?.nodeType === Node.TEXT_NODE) {
    const text = following.textContent ?? "";
    // A run of spaces is the separator inserted along with the pill, and the
    // caret belongs after it. Anything else is the user's own text: stay at
    // its start, or a pill inserted mid-line throws the caret to the end of
    // the line (and onto the next one when a line break follows).
    range.setStart(following, /^ +$/.test(text) ? text.length : 0);
  } else {
    range.setStartAfter(pill);
  }
  range.collapse(true);
  applyCaretRange(range);
}

export function placeCaretAtPoint(
  host: HTMLElement,
  x: number,
  y: number
): boolean {
  const range = getCaretRangeFromPoint(x, y);
  if (!range) return false;

  if (!host.contains(range.startContainer)) return false;

  const selection = window.getSelection();
  if (!selection) return false;

  host.focus();
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

/**
 * Insert a node at the current caret position (or at the end of `host` if
 * no in-host selection exists). The caret is placed immediately after the
 * inserted node so the next typed character lands after the pill.
 */
export function insertNodeAtCaret(host: HTMLElement, node: Node): void {
  const range = focusedRangeInsideHost(host);
  host.focus();
  range.deleteContents();
  range.insertNode(node);
  placeCaretAfter(node);
}

/** Find the nearest pill ancestor (or self) of a DOM node, if any. */
export function findPillAncestor(node: Node | null): HTMLElement | null {
  let current: Node | null = node;
  while (current) {
    if (current.nodeType === Node.ELEMENT_NODE) {
      const element = current as HTMLElement;
      if (element.getAttribute(PILL_DATA_ATTR) === "true") return element;
    }
    current = current.parentNode;
  }
  return null;
}

/**
 * Offset of the given DOM point in plain-text coordinates: an index into
 * `extractPlainText(host)`.
 *
 * Measured by serializing the content before the point with that same
 * function, so the two cannot disagree. `Range.toString()` did: it counts a
 * pill as its rendered label (truncated past ten characters), a `<br>` as
 * nothing, and zero-width anchors as text. Offsets taken that way and then
 * applied to the plain text searched mentions for the wrong query, and removed
 * the wrong span — an earlier pill included — when one was picked.
 */
export function caretTextOffset(host: HTMLElement, range: Range): number {
  const preRange = document.createRange();
  preRange.selectNodeContents(host);
  preRange.setEnd(range.startContainer, range.startOffset);
  const prefix = document.createElement("div");
  prefix.appendChild(preRange.cloneContents());
  return extractPlainText(prefix).length;
}
