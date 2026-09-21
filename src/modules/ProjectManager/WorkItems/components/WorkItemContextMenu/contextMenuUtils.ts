import { matchesShortcut } from "@src/config/keyboard/shortcutBindings";
import { getShortcutKeys } from "@src/config/keyboard/shortcutDisplay";
import type { ContextMenuItem } from "@src/types/core/shared";

export function getShortcutLabel(item: ContextMenuItem): string {
  if (item.shortcutId) return getShortcutKeys(item.shortcutId);
  if (item.keybinding) return item.keybinding.toUpperCase();
  return item.shortcut ?? "";
}

export function getContextMenuShortcut(item: ContextMenuItem): string {
  return item.keybinding ?? item.shortcut ?? "";
}

export function matchesContextShortcut(
  item: ContextMenuItem,
  event: KeyboardEvent
): boolean {
  if (item.shortcutId) return matchesShortcut(event, item.shortcutId);
  const shortcut = getContextMenuShortcut(item);
  if (!shortcut) return false;
  const normalized = shortcut.toLowerCase();
  if (normalized.length !== 1) return false;
  return (
    event.key.toLowerCase() === normalized &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey
  );
}
