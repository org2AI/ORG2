/**
 * Settings Hooks
 *
 * Hooks for managing application settings, preferences, and cross-window sync.
 */

export { useCrossWindowSettingsSync } from "./useCrossWindowSettingsSync";

export {
  useEditorAppearanceSettings,
  useEditorAppearanceStyles,
} from "./useEditorAppearance";

export { useSettingValue } from "./useSettings";

export { useDevModeGuard } from "./useDevModeGuard";

export {
  type DockIconVariant,
  useDockIconPreference,
} from "./useDockIconPreference";
export { usePointerCursorPreference } from "./usePointerCursorPreference";

export { useSleepInhibitor } from "./useSleepInhibitor";

export { useLearningsBrowser } from "./useLearningsBrowser";
