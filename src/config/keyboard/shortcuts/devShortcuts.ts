import type { ShortcutEntry } from "./types";

/**
 * Development-build-only shortcuts.
 *
 * `allShortcuts.ts` spreads these in only when `NODE_ENV === "development"`,
 * so a release build's dispatcher, Settings → Shortcuts table, and shortcut
 * recorder never see them — the chords stay free for real features.
 */
export const DEV_SHORTCUTS: ShortcutEntry[] = [
  {
    // ⌘D is taken in the editor (add selection) and ⇧D in Project Manager,
    // both narrower scopes than this global chord.
    id: "open_dev_mock_scenarios",
    command: "Dev mock scenarios",
    macKeys: "⇧⌘D",
    winKeys: "Ctrl+Shift+D",
    scope: "global",
    category: "debugging",
  },
];
