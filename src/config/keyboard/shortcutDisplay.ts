/**
 * Shortcut Display Utilities
 *
 * Platform-aware lookup for shortcut display strings.
 * All UI code should use these functions instead of hardcoding "⌘J" / "Ctrl+J".
 */
import {
  CURRENT_SHORTCUT_PLATFORM,
  type ShortcutPlatform,
  bindingAccelerator,
  defaultBindings,
  formatBinding,
  getOverride,
} from "./shortcutBindings";
import { ALL_SHORTCUTS, type ShortcutEntry } from "./shortcuts";

const shortcutMap = new Map<string, ShortcutEntry>();
for (const entry of ALL_SHORTCUTS) {
  shortcutMap.set(entry.id, entry);
}

export interface ShortcutDisplayOptions {
  chatSendOnEnter?: boolean;
  platform?: ShortcutPlatform;
}

/** Get platform-appropriate display string for a shortcut by ID. */
export function getShortcutKeys(
  id: string,
  options?: ShortcutDisplayOptions
): string {
  const platform = options?.platform ?? CURRENT_SHORTCUT_PLATFORM;
  const custom = getOverride(id, platform);
  if (custom) return formatBinding(custom, platform);
  if (id === "chat_send" && options?.chatSendOnEnter) return "Enter";
  const entry = shortcutMap.get(id);
  if (!entry) return "";
  return platform === "mac" ? entry.macKeys : entry.winKeys;
}

/** Get the Tauri accelerator for a native menu item by shortcut ID. */
export function getShortcutAccelerator(id: string): string | undefined {
  const custom = getOverride(id);
  if (custom) return bindingAccelerator(custom);
  const entry = shortcutMap.get(id);
  const binding = defaultBindings(id)[0];
  return entry?.accelerator && binding
    ? bindingAccelerator(binding)
    : undefined;
}
