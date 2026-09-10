import { useEffect, useRef } from "react";

import { matchesShortcut } from "@src/config/keyboard/shortcutBindings";

/**
 * Registers a Cmd+S / Ctrl+S keyboard shortcut that calls `onSave`.
 * Automatically prevents the browser's default save-page dialog.
 * No-op when `enabled` is false (e.g. no pending changes).
 *
 * Uses a ref for `onSave` so the event listener is only re-registered
 * when `enabled` changes — not on every render when the callback reference
 * changes (which would cause stutter during rapid typing).
 */
export function useKeyboardSave(
  onSave: (() => void) | undefined,
  enabled = true
) {
  const onSaveRef = useRef(onSave);
  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  useEffect(() => {
    if (!enabled) return;

    const handler = (event: KeyboardEvent) => {
      if (!matchesShortcut(event, "save_file")) return;

      event.preventDefault();
      onSaveRef.current?.();
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [enabled]);
}
