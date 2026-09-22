import type { ShortcutEntry } from "./types";

export const DATABASE_SHORTCUTS: ShortcutEntry[] = [
  {
    id: "db_sidebar",
    command: "Toggle sidebar",
    macKeys: "⌥⌘U",
    winKeys: "Ctrl+Alt+U",
    scope: "database",
    category: "panels",
  },
  {
    id: "db_connections",
    command: "Open connections",
    macKeys: "",
    winKeys: "",
    scope: "database",
    category: "navigation",
  },
];
