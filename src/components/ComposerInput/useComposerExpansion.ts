import {
  type RefObject,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { placeCaretAtEnd } from "./selection";

/** Applied to ComposerInput while it shows the tall writing surface. */
export const COMPOSER_EXPANDED_CLASS = "composer-input-expanded";

/** Slack before a sub-pixel scrollHeight rounding reads as overflow. */
const OVERFLOW_TOLERANCE_PX = 1;

interface ComposerEditorNodes {
  /** ComposerInput root — the element that caps height and scrolls. */
  scroller: HTMLElement;
  /** The contenteditable document host. */
  host: HTMLElement;
}

function findEditorNodes(
  frame: HTMLElement | null
): ComposerEditorNodes | null {
  const scroller = frame?.querySelector<HTMLElement>(".composer-input");
  const host = scroller?.querySelector<HTMLElement>(".composer-input-content");
  return scroller && host ? { scroller, host } : null;
}

function overflowsCap(scroller: HTMLElement): boolean {
  return scroller.scrollHeight - scroller.clientHeight > OVERFLOW_TOLERANCE_PX;
}

/** Scrolls the minimum distance that brings the caret inside the scroller. */
function scrollCaretIntoView(scroller: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  if (!scroller.contains(range.endContainer)) return;
  const caret = range.getBoundingClientRect();
  if (caret.top === 0 && caret.bottom === 0) return;
  const box = scroller.getBoundingClientRect();
  if (caret.bottom > box.bottom) {
    scroller.scrollTop += caret.bottom - box.bottom;
  } else if (caret.top < box.top) {
    scroller.scrollTop -= box.top - caret.top;
  }
}

/** Returns focus to the document after the toggle, keeping the caret in view. */
function refocusEditor({ scroller, host }: ComposerEditorNodes): void {
  if (document.activeElement !== host) {
    host.focus({ preventScroll: true });
  }
  const selection = window.getSelection();
  const anchor = selection?.rangeCount
    ? selection.getRangeAt(0).endContainer
    : null;
  if (!anchor || !host.contains(anchor)) placeCaretAtEnd(host);
  scrollCaretIntoView(scroller);
}

export interface ComposerExpansion {
  /** Whether the editor currently shows the tall writing surface. */
  expanded: boolean;
  /** Whether the expand/collapse toggle should render. */
  showToggle: boolean;
  /** Extra ComposerInput classes that apply the expanded height. */
  editorClassName: string;
  toggle: () => void;
}

/**
 * Lets a composer grow past its auto-height cap into a taller writing surface
 * in place, so long prompts never need a separate editor.
 *
 * `frameRef` must be an ancestor of exactly one ComposerInput, and `enabled`
 * must turn false while that editor is unmounted so the observers re-attach
 * to the remounted node. The toggle is offered once the document overflows the
 * resting cap, and stays while expanded so it can always collapse. The
 * expanded state ends when the document is cleared, so sending a message
 * returns the composer to its resting size.
 */
export function useComposerExpansion(
  frameRef: RefObject<HTMLElement | null>,
  enabled: boolean
): ComposerExpansion {
  const [expandedState, setExpandedState] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const refocusPendingRef = useRef(false);
  const expanded = enabled && expandedState;

  useLayoutEffect(() => {
    if (!enabled) return;
    const nodes = findEditorNodes(frameRef.current);
    if (!nodes) return;
    const { scroller, host } = nodes;

    const measure = () => setOverflowing(overflowsCap(scroller));
    const collapseWhenEmpty = () => {
      if (host.classList.contains("is-empty")) setExpandedState(false);
    };
    measure();
    collapseWhenEmpty();

    // The host grows with the document; the scroller changes when the cap or
    // the available width does. Either can flip the overflow answer.
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    resizeObserver?.observe(scroller);
    resizeObserver?.observe(host);
    // ComposerInput owns emptiness and mirrors it as `is-empty`, which also
    // covers imperative clears after a send.
    const emptinessObserver = new MutationObserver(collapseWhenEmpty);
    emptinessObserver.observe(host, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => {
      resizeObserver?.disconnect();
      emptinessObserver.disconnect();
      setExpandedState(false);
    };
  }, [enabled, frameRef]);

  // The height cap changes with `expanded`. Re-measure before paint so the
  // toggle never blinks out between the collapse and the next resize callback.
  useLayoutEffect(() => {
    const nodes = findEditorNodes(frameRef.current);
    if (!nodes) return;
    setOverflowing(overflowsCap(nodes.scroller));
    if (refocusPendingRef.current) {
      refocusPendingRef.current = false;
      refocusEditor(nodes);
    }
  }, [expanded, frameRef]);

  const toggle = useCallback(() => {
    refocusPendingRef.current = true;
    setExpandedState((value) => !value);
  }, []);

  return {
    expanded,
    showToggle: enabled && (expanded || overflowing),
    editorClassName: expanded ? COMPOSER_EXPANDED_CLASS : "",
    toggle,
  };
}
