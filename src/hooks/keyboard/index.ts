/**
 * Keyboard Hooks
 *
 * Centralized keyboard utilities for navigation, shortcuts, and input handling.
 */

// ============================================
// Hooks
// ============================================

export { useListNavigation } from "./useListNavigation";

export { useKeyboardSave } from "./useKeyboardSave";

export {
  DEFAULT_SEARCH_SHORTCUT_ID,
  useSearchShortcut,
} from "./useSearchShortcut";
export type { UseSearchShortcutOptions } from "./useSearchShortcut";

export { useTauriSelectAllShortcut } from "./useTauriSelectAllShortcut";

export { useKeyboardMouseMode } from "./useKeyboardMouseMode";

// ============================================
// Shortcut Registry (runtime event matching)
// ============================================

export { shortcutRegistry } from "@src/config/keyboard/ShortcutRegistry";

// ============================================
// Shortcut Display (centralized lookup)
// ============================================

export {
  getShortcutKeys,
  getShortcutAccelerator,
} from "@src/config/keyboard/shortcutDisplay";
