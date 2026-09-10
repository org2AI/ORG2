/**
 * Settings Store
 *
 * VS Code-style settings system backed by `~/.orgii/settings.jsonc`.
 *
 * Public API:
 * - `useSetting(key)` — Read/write a single setting
 * - `useAllSettings()` — Read the full settings object
 * - `useSettingsSync()` — Initialize and listen for file changes (call once)
 */

// Atoms
export { settingsAtom, updateSettingAtom } from "./settingsAtom";

// Hooks (canonical location: @src/hooks/settings/useSettings)
export { useSetting, useAllSettings } from "@src/hooks/settings/useSettings";

// Sync (file watcher listener)
export { useSettingsSync } from "./settingsSync";
