import { type RefObject, useEffect } from "react";

import { matchesShortcut } from "@src/config/keyboard/shortcutBindings";

/** ⌘F / Ctrl+F — "Search the list", the default for list and table searches. */
export const DEFAULT_SEARCH_SHORTCUT_ID = "list_search";

export interface UseSearchShortcutOptions {
  /** Registered shortcut id. Default: {@link DEFAULT_SEARCH_SHORTCUT_ID}. */
  shortcutId?: string;
  /** No-op while false — e.g. the field is behind a disabled feature flag. */
  enabled?: boolean;
}

interface SearchField {
  input: RefObject<HTMLInputElement | null>;
  shortcutId: string;
}

/**
 * Every mounted search field, in mount order.
 *
 * The binding is on by default for every SettingsTable, so several fields can
 * be mounted at once — a settings page behind a detail panel, a table in a
 * hidden tab. One shared listener arbitrates between them instead of each
 * field racing the others with its own `keydown` handler.
 */
const fields: SearchField[] = [];
let listening = false;

/** A field in a closed tab or a hidden panel still exists in the DOM; only one
 *  that actually paints can answer the chord. */
function isVisible(input: HTMLInputElement): boolean {
  return input.getClientRects().length > 0;
}

/**
 * The field the user means: the one they are already typing in, else the
 * last-mounted visible one — panels and dialogs mount over the page behind
 * them, so the newest visible field is the foreground one.
 */
function resolveTarget(): SearchField | undefined {
  const visible = fields.filter(
    (field) => field.input.current && isVisible(field.input.current)
  );
  if (visible.length === 0) return undefined;

  const focused = visible.find(
    (field) => field.input.current === document.activeElement
  );
  return focused ?? visible[visible.length - 1];
}

function handleKeydown(event: KeyboardEvent): void {
  const target = resolveTarget();
  if (!target?.input.current) return;
  if (!matchesShortcut(event, target.shortcutId)) return;

  const input = target.input.current;
  const eventTarget = event.target;
  if (eventTarget instanceof Element && eventTarget !== input) {
    // Another editable surface owns this chord: ⌘F inside a code editor means
    // "find in this editor", not "jump to the list search".
    if (
      eventTarget.closest(
        "input, textarea, select, [contenteditable='true'], .cm-editor"
      )
    ) {
      return;
    }
  }

  event.preventDefault();
  input.focus();
  input.select();
}

/**
 * Focuses a search field when its shortcut is pressed, and selects whatever is
 * already typed so the next keystroke replaces it.
 *
 * SettingsTable wires this for every search field it renders, so a consumer
 * normally gets it without asking. Call it directly for a search field that
 * lives outside a SettingsTable.
 */
export function useSearchShortcut(
  inputRef: RefObject<HTMLInputElement | null>,
  options: UseSearchShortcutOptions = {}
): void {
  const { shortcutId = DEFAULT_SEARCH_SHORTCUT_ID, enabled = true } = options;

  useEffect(() => {
    if (!enabled) return;

    const field: SearchField = { input: inputRef, shortcutId };
    fields.push(field);
    if (!listening) {
      document.addEventListener("keydown", handleKeydown);
      listening = true;
    }

    return () => {
      const index = fields.indexOf(field);
      if (index !== -1) fields.splice(index, 1);
      if (fields.length === 0 && listening) {
        document.removeEventListener("keydown", handleKeydown);
        listening = false;
      }
    };
  }, [enabled, inputRef, shortcutId]);
}
