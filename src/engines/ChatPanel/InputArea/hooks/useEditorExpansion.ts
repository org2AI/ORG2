import {
  type RefObject,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

interface UseEditorExpansionOptions {
  /** Whether this composer honors the compact-input preference at all. */
  enabled: boolean;
  /** Whether the compact row is allowed apart from the document itself. */
  compactEligible: boolean;
  /** InputArea root that hosts the composer shell. */
  containerRef: RefObject<HTMLElement | null>;
  handleContentChange: (text: string) => void;
}

interface UseEditorExpansionReturn {
  editorMultiline: boolean;
  onEditorContentChange: (text: string) => void;
}

/** Share of the editor slot one line may fill before the row expands. */
const COMPACT_ROW_FILL_RATIO = 0.8;

const EDITOR_CONTENT_SELECTOR =
  "[data-composer-menu-anchor] [data-editor-slot] .composer-input-content";

/** Whitespace-only check that stops at the first visible character. */
function isBlank(text: string): boolean {
  return !/\S/.test(text);
}

function findEditorContent(container: HTMLElement | null): HTMLElement | null {
  return container?.querySelector<HTMLElement>(EDITOR_CONTENT_SELECTOR) ?? null;
}

/**
 * Ink extent of the live document. The contenteditable host is a full-width
 * block, so its own box says nothing about how much of the row the text uses.
 */
function measureContentWidth(host: HTMLElement): number {
  if (!host.firstChild) return 0;
  const range = document.createRange();
  range.selectNodeContents(host);
  return range.getBoundingClientRect().width;
}

/**
 * A document needs the stacked editor once it holds a newline or an inline
 * pill, or — while the compact row is showing — once its single line fills
 * most of the row.
 */
function needsStackedEditor(
  text: string,
  content: HTMLElement | null,
  measureRowFill: boolean
): boolean {
  if (text.includes("\n")) return true;
  if (content?.querySelector("[data-composer-pill]")) return true;
  if (!measureRowFill || !content || isBlank(text)) return false;
  const slot = content.closest<HTMLElement>("[data-editor-slot]");
  if (!slot || slot.clientWidth <= 0) return false;
  return (
    measureContentWidth(content) / slot.clientWidth >= COMPACT_ROW_FILL_RATIO
  );
}

/**
 * Moves a compact composer row to the stacked editor when its document can no
 * longer be shown on one line. The stacked editor sticks until the document is
 * cleared, so deleting back below the fill threshold never bounces the layout
 * mid-edit.
 */
export function useEditorExpansion({
  enabled,
  compactEligible,
  containerRef,
  handleContentChange,
}: UseEditorExpansionOptions): UseEditorExpansionReturn {
  const [editorMultiline, setEditorMultiline] = useState(false);
  // Latest serialized document, re-measured on resize and whenever the compact
  // row returns around content typed while it was unavailable.
  const documentTextRef = useRef("");

  const onEditorContentChange = useCallback(
    (text: string) => {
      documentTextRef.current = text;
      handleContentChange(text);
      // A bare newline still needs the stacked editor; anything else blank is
      // a cleared document (or one cleared while the capsule was unavailable).
      if (isBlank(text) && !(enabled && text.includes("\n"))) {
        setEditorMultiline(false);
        return;
      }
      // Once stacked, the layout only changes on clear, so skip the per-key
      // DOM queries and the layout-forcing width measurement.
      if (!enabled || editorMultiline) return;
      if (
        needsStackedEditor(
          text,
          findEditorContent(containerRef.current),
          compactEligible
        )
      ) {
        setEditorMultiline(true);
      }
    },
    [
      compactEligible,
      containerRef,
      editorMultiline,
      enabled,
      handleContentChange,
    ]
  );

  // ResizeObserver is the external browser resource synchronized here. It is
  // connected only while the compact row is showing; the first check runs
  // before paint so a row that reappears around long content (preference
  // switched on, attachment removed) never flashes, and the observer
  // disconnects once the editor expands or the composer unmounts.
  useLayoutEffect(() => {
    if (!enabled || !compactEligible || editorMultiline) return;
    const content = findEditorContent(containerRef.current);
    const slot = content?.closest<HTMLElement>("[data-editor-slot]");
    if (!content || !slot) return;

    const check = () => {
      if (needsStackedEditor(documentTextRef.current, content, true)) {
        setEditorMultiline(true);
      }
    };

    check();
    const observer = new ResizeObserver(check);
    observer.observe(content);
    observer.observe(slot);
    return () => observer.disconnect();
  }, [compactEligible, containerRef, editorMultiline, enabled]);

  return {
    editorMultiline: enabled && editorMultiline,
    onEditorContentChange,
  };
}
