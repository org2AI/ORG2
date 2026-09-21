import { useSettingValue } from "@src/hooks/settings/useSettings";

export interface ButtonTooltipTiming {
  enabled: boolean;
  delayMs: number;
}

/**
 * The user's Appearance → Tooltips preference, the single source of hover
 * timing for every `<Tooltip kind="button">`.
 */
export function useButtonTooltipTiming(): ButtonTooltipTiming {
  const enabled = useSettingValue("general.buttonTooltipsEnabled");
  const delayMs = useSettingValue("general.buttonTooltipDelayMs");
  return { enabled, delayMs };
}
