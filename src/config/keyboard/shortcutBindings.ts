import { ALL_SHORTCUTS } from "./shortcuts";

export type ShortcutPlatform = "mac" | "windows" | "linux";
export interface KeyBinding {
  key: string;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
}
export type ShortcutOverrides = Partial<
  Record<ShortcutPlatform, Record<string, KeyBinding>>
>;
export const SHORTCUT_STORAGE_KEY = "orgii:shortcutOverrides:v1";
export const shortcutAliases: Record<string, string> = {
  spotlight_open: "toggle_spotlight",
  close_file: "close_tab",
  browser_new_tab: "new_tab",
  browser_search: "quick_open",
  db_sidebar: "toggle_workstation_sidebar",
  project_toggle_sidebar: "toggle_workstation_sidebar",
};
export const canonicalShortcutId = (id: string) => shortcutAliases[id] ?? id;
export const CURRENT_SHORTCUT_PLATFORM: ShortcutPlatform =
  typeof navigator !== "undefined" && /mac/i.test(navigator.platform)
    ? "mac"
    : typeof navigator !== "undefined" && /linux/i.test(navigator.platform)
      ? "linux"
      : "windows";
const catalog = new Map(ALL_SHORTCUTS.map((entry) => [entry.id, entry]));

// Only expose recording for commands whose owning dispatcher consumes this resolver.
// Text entry, OS editing, and generic widget navigation remain native interactions.
export const CUSTOMIZABLE_SHORTCUT_IDS = new Set([
  "toggle_captions",
  "voice_input",
  "file_menu_rename",
  "file_menu_delete",
  "chat_send",
  "go_to_line",
  "find",
  "find_replace",
  "quit_app",
  "close_tab",
  "maximize_work_station",
  "open_my_station",
  "open_agent_station",
  "open_kanban",
  "toggle_ade_manager",
  "new_session",
  "new_tab",
  "new_tab_alt",
  "open_settings",
  "toggle_spotlight",
  "open_model_selector",
  "open_workspace_selector",
  "open_branch_selector",
  "open_location_selector",
  "window_open_folder",
  "window_close",
  "next_tab",
  "previous_tab",
  "zoom_in",
  "zoom_out",
  "zoom_reset",
  "toggle_api_panel",
  "toggle_inspect_mode",
  "capture_component",
  "agent_session_search",
  "quick_open",
  "go_to_symbol",
  "search_files",
  "toggle_sidebar",
  "toggle_workstation_sidebar",
  "open_file_folder_tab",
  "open_source_control_tab",
  "open_terminal_tab",
  "maximize_chat",
  "save_file",
  "git_commit",
  "git_stage_all",
  "git_unstage_all",
  "git_refresh",
  "git_toggle_stage",
  "git_open_diff",
  "git_discard",
  "reload_file",
  "db_run_query",
  "file_menu_new_file",
  "file_menu_new_folder",
  "file_menu_duplicate",
  "file_menu_copy",
  "file_menu_paste",
  "file_menu_copy_path",
  "file_menu_copy_relative_path",
  "workitem_due_date",
  "workitem_story",
  "workitem_rename",
  "workitem_add_link",
  "workitem_favorite",
  "workitem_delete",
  "chat_go_back",
  "chat_go_forward",
  "chat_prev_tab",
  "chat_next_tab",
]);
export const canCustomizeShortcut = (id: string) =>
  CUSTOMIZABLE_SHORTCUT_IDS.has(canonicalShortcutId(id));
const keyAliases: Record<string, string> = {
  "↑": "ArrowUp",
  "↓": "ArrowDown",
  "←": "ArrowLeft",
  "→": "ArrowRight",
  "⌫": "Backspace",
  Esc: "Escape",
  Space: " ",
  Plus: "+",
  Minus: "-",
};
export function parseBinding(text: string): KeyBinding | undefined {
  if (!text.trim()) return undefined;
  let rest = text.trim();
  const binding: KeyBinding = {
    key: "",
    ctrl: false,
    meta: false,
    alt: false,
    shift: false,
  };
  const modifiers: [RegExp, "ctrl" | "meta" | "alt" | "shift"][] = [
    [/^(?:Ctrl\+|Control\+|⌃)/i, "ctrl"],
    [/^(?:Cmd\+|Meta\+|⌘)/i, "meta"],
    [/^(?:Alt\+|Option\+|⌥)/i, "alt"],
    [/^(?:Shift\+|⇧)/i, "shift"],
  ];
  let modifier = modifiers.find(([pattern]) => pattern.test(rest));
  while (modifier) {
    binding[modifier[1]] = true;
    rest = rest.replace(modifier[0], "").trim();
    if (rest.startsWith("+") && rest.length > 1) rest = rest.slice(1);
    modifier = modifiers.find(([pattern]) => pattern.test(rest));
  }
  binding.key =
    keyAliases[rest] ?? (rest.length === 1 ? rest.toLowerCase() : rest);
  return binding;
}
// Fixed-size catalog cache: key matching never reparses display strings.
const defaults = new Map<string, KeyBinding[]>();
for (const platform of ["mac", "windows", "linux"] as const) {
  for (const entry of ALL_SHORTCUTS) {
    defaults.set(
      `${platform}:${entry.id}`,
      (platform === "mac" ? entry.macKeys : entry.winKeys)
        .split(" / ")
        .map(parseBinding)
        .filter((binding): binding is KeyBinding => !!binding)
    );
  }
}
const noBindings: KeyBinding[] = [];
export function defaultBindings(
  id: string,
  platform = CURRENT_SHORTCUT_PLATFORM
): KeyBinding[] {
  return defaults.get(`${platform}:${canonicalShortcutId(id)}`) ?? noBindings;
}
export function bindingEquals(a: KeyBinding, b: KeyBinding): boolean {
  return (
    a.key === b.key &&
    a.ctrl === b.ctrl &&
    a.meta === b.meta &&
    a.alt === b.alt &&
    a.shift === b.shift
  );
}
export function formatBinding(
  binding: KeyBinding,
  platform = CURRENT_SHORTCUT_PLATFORM
): string {
  const key =
    binding.key === " "
      ? "Space"
      : binding.key.length === 1
        ? binding.key.toUpperCase()
        : binding.key;
  if (platform === "mac")
    return `${binding.ctrl ? "⌃" : ""}${binding.alt ? "⌥" : ""}${binding.shift ? "⇧" : ""}${binding.meta ? "⌘" : ""}${key.length > 1 ? " " : ""}${key}`.trim();
  return [
    binding.ctrl && "Ctrl",
    binding.alt && "Alt",
    binding.shift && "Shift",
    binding.meta && "Meta",
    key,
  ]
    .filter(Boolean)
    .join("+");
}
export function bindingAccelerator(binding: KeyBinding): string {
  const key =
    binding.key === "+"
      ? "Plus"
      : binding.key === " "
        ? "Space"
        : binding.key.replace(/^Arrow/, "");
  return [
    binding.ctrl && "Ctrl",
    binding.meta && "Super",
    binding.alt && "Alt",
    binding.shift && "Shift",
    key,
  ]
    .filter(Boolean)
    .join("+");
}
export function bindingFromEvent(
  event: Pick<
    KeyboardEvent,
    | "key"
    | "code"
    | "ctrlKey"
    | "metaKey"
    | "altKey"
    | "shiftKey"
    | "isComposing"
  >
): KeyBinding | undefined {
  if (
    event.isComposing ||
    ["Control", "Meta", "Alt", "Shift", "Unidentified", "AltGraph"].includes(
      event.key
    )
  )
    return undefined;
  // Use physical ASCII keys for Option/dead-key and shifted punctuation parity.
  const punctuation: Record<string, string> = {
    BracketLeft: "[",
    BracketRight: "]",
    Backslash: "\\",
    Slash: "/",
    Period: ".",
    Comma: ",",
    Minus: "-",
    Equal: "=",
    Semicolon: ";",
    Quote: "'",
    Backquote: "`",
  };
  const key = /^Key[A-Z]$/.test(event.code)
    ? event.code.slice(3).toLowerCase()
    : /^Digit[0-9]$/.test(event.code)
      ? event.code.slice(5)
      : (punctuation[event.code] ??
        (event.key.length === 1 ? event.key.toLowerCase() : event.key));
  return {
    key,
    ctrl: event.ctrlKey,
    meta: event.metaKey,
    alt: event.altKey,
    shift: event.shiftKey,
  };
}
function validBinding(value: unknown): value is KeyBinding {
  if (!value || typeof value !== "object") return false;
  const b = value as KeyBinding;
  return (
    typeof b.key === "string" &&
    /^(?:[-a-z0-9 ,./;'[\]\\`=+]|F(?:[1-9]|1[0-9]|2[0-4])|Arrow(?:Up|Down|Left|Right)|Enter|Tab|Backspace|Delete|Home|End|PageUp|PageDown)$/.test(
      b.key
    ) &&
    [b.ctrl, b.meta, b.alt, b.shift].every((v) => typeof v === "boolean")
  );
}
export function sanitizeOverrides(value: unknown): ShortcutOverrides {
  const result: ShortcutOverrides = {};
  if (!value || typeof value !== "object") return result;
  for (const platform of ["mac", "windows", "linux"] as const) {
    const entries = (value as ShortcutOverrides)[platform];
    if (!entries || typeof entries !== "object") continue;
    for (const [id, binding] of Object.entries(entries)) {
      if (
        canonicalShortcutId(id) !== id ||
        !canCustomizeShortcut(id) ||
        !validBinding(binding)
      )
        continue;
      if (
        defaultBindings(id, platform).some((def) => bindingEquals(def, binding))
      )
        continue;
      if (!isSafeCustomBinding(binding)) continue;
      (result[platform] ??= {})[id] = {
        key: binding.key,
        ctrl: binding.ctrl,
        meta: binding.meta,
        alt: binding.alt,
        shift: binding.shift,
      };
    }
  }
  // Validate against the complete snapshot: another remap may have freed a
  // default chord. Prune invalid conflicts until fallbacks are consistent.
  let removed = true;
  while (removed) {
    removed = false;
    for (const platform of ["mac", "windows", "linux"] as const) {
      for (const [id, binding] of Object.entries(result[platform] ?? {})) {
        if (findShortcutConflict(id, platform, binding, result)) {
          delete result[platform]![id];
          removed = true;
        }
      }
      if (result[platform] && !Object.keys(result[platform]!).length)
        delete result[platform];
    }
  }
  return result;
}
function readOverrides(): ShortcutOverrides {
  try {
    return sanitizeOverrides(
      JSON.parse(localStorage.getItem(SHORTCUT_STORAGE_KEY) ?? "{}")
    );
  } catch {
    return {};
  }
}
let overrides = readOverrides();
const listeners = new Set<() => void>();
export const getShortcutOverrides = () => overrides;
const emitChange = () => listeners.forEach((listener) => listener());
function onStorage(event: StorageEvent) {
  if (event.key !== SHORTCUT_STORAGE_KEY && event.key !== null) return;
  overrides = readOverrides();
  emitChange();
}
export function subscribeShortcutBindings(listener: () => void): () => void {
  if (!listeners.size && typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
    overrides = readOverrides();
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size && typeof window !== "undefined")
      window.removeEventListener("storage", onStorage);
  };
}
function persist(next: ShortcutOverrides) {
  // Write first: failed persistence must not advertise a binding that is lost on restart.
  localStorage.setItem(SHORTCUT_STORAGE_KEY, JSON.stringify(next));
  overrides = next;
  emitChange();
}
export function getOverride(
  id: string,
  platform = CURRENT_SHORTCUT_PLATFORM
): KeyBinding | undefined {
  return overrides[platform]?.[canonicalShortcutId(id)];
}
export function resolvedBindings(
  id: string,
  platform = CURRENT_SHORTCUT_PLATFORM
): KeyBinding[] {
  const custom = getOverride(id, platform);
  return custom ? [custom] : defaultBindings(id, platform);
}
export function setShortcutBinding(
  id: string,
  platform: ShortcutPlatform,
  binding: KeyBinding
): void {
  id = canonicalShortcutId(id);
  if (!canCustomizeShortcut(id) || !validBinding(binding))
    throw new Error("Invalid shortcut");
  if (
    !defaultBindings(id, platform).some((def) => bindingEquals(def, binding))
  ) {
    if (!isSafeCustomBinding(binding))
      throw new Error("A modifier or function key is required");
    const conflict = findShortcutConflict(id, platform, binding);
    if (conflict) throw new Error(`Shortcut already used by ${conflict}`);
  }
  const next = { ...overrides, [platform]: { ...overrides[platform] } };
  if (
    defaultBindings(id, platform).some((def) => bindingEquals(def, binding))
  ) {
    delete next[platform]![id];
    if (!Object.keys(next[platform]!).length) delete next[platform];
  } else next[platform]![id] = { ...binding };
  persist(next);
}
export function resetShortcutBindings(
  platform?: ShortcutPlatform,
  id?: string
): void {
  const next = { ...overrides };
  if (!platform) return persist({});
  if (id) {
    next[platform] = { ...next[platform] };
    delete next[platform]![canonicalShortcutId(id)];
    if (!Object.keys(next[platform]!).length) delete next[platform];
  } else delete next[platform];
  persist(next);
}
export function isSafeCustomBinding(binding: KeyBinding): boolean {
  return (
    binding.ctrl || binding.meta || binding.alt || /^F\d+$/.test(binding.key)
  );
}
export function findShortcutConflict(
  id: string,
  platform: ShortcutPlatform,
  binding: KeyBinding,
  state: ShortcutOverrides = overrides
): string | undefined {
  const ownId = canonicalShortcutId(id);
  if (
    defaultBindings(ownId, platform).some((def) => bindingEquals(def, binding))
  )
    return undefined;
  const own = catalog.get(ownId);
  return ALL_SHORTCUTS.find(
    (entry) =>
      canonicalShortcutId(entry.id) !== ownId &&
      (entry.scope === own?.scope ||
        entry.scope === "global" ||
        own?.scope === "global") &&
      (state[platform]?.[canonicalShortcutId(entry.id)]
        ? [state[platform]![canonicalShortcutId(entry.id)]]
        : defaultBindings(entry.id, platform)
      ).some((other) => bindingEquals(other, binding))
  )?.command;
}
let recording = false;
export const isRecordingShortcut = () => recording;
export const setRecordingShortcut = (value: boolean) => {
  recording = value;
};
export function matchesShortcut(
  event: KeyboardEvent,
  id: string,
  platform = CURRENT_SHORTCUT_PLATFORM
): boolean {
  if (recording || event.isComposing || event.getModifierState?.("AltGraph"))
    return false;
  const actual = bindingFromEvent(event);
  if (!actual) return false;
  if (!getOverride(id, platform)) {
    if (
      id === "file_menu_rename" &&
      actual.key === "F2" &&
      !actual.ctrl &&
      !actual.meta &&
      !actual.alt &&
      !actual.shift
    )
      return true;
    if (id === "file_menu_delete" && actual.key === "Delete") {
      return resolvedBindings(id, platform).some((binding) =>
        bindingEquals({ ...actual, key: "Backspace" }, binding)
      );
    }
  }
  return resolvedBindings(id, platform).some((binding) => {
    if (bindingEquals(actual, binding)) return true;
    if (
      !getOverride(id, platform) &&
      id === "git_discard" &&
      !actual.ctrl &&
      !actual.meta &&
      !actual.alt &&
      !actual.shift &&
      ["Backspace", "Delete"].includes(actual.key)
    )
      return true;
    // Preserve the existing unshifted/shifted zoom-in variants, only for defaults.
    return (
      !getOverride(id, platform) &&
      id === "zoom_in" &&
      actual.key === "=" &&
      actual.ctrl === binding.ctrl &&
      actual.meta === binding.meta &&
      !actual.alt
    );
  });
}

export function matchesDefaultShortcut(
  event: KeyboardEvent,
  id: string
): boolean {
  const actual = bindingFromEvent(event);
  return (
    !!actual &&
    defaultBindings(id).some((binding) => bindingEquals(actual, binding))
  );
}
