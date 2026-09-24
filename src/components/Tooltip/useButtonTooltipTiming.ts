import { useAtomValue } from "jotai";

// Read the value atoms directly, not `useSettingValue`: that hook's module
// also carries the Tauri-backed writers, and `Tooltip` renders in
// browser-safe shared components such as `PageNotice`.
import { settingAtom } from "@src/store/settings/settingsValueAtoms";

export interface ButtonTooltipTiming {
  enabled: boolean;
  delayMs: number;
}

/**
 * The user's Appearance → Tooltips preference, the single source of hover
 * timing for every `<Tooltip kind="button">`.
 */
export function useButtonTooltipTiming(): ButtonTooltipTiming {
  const enabled = useAtomValue(settingAtom("general.buttonTooltipsEnabled"));
  const delayMs = useAtomValue(settingAtom("general.buttonTooltipDelayMs"));
  return { enabled, delayMs };
}
