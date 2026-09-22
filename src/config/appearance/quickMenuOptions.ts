/**
 * Option lists shared by the in-context settings menus (sidebar Layout and
 * Appearance flyouts, Spotlight settings, file header Sidebar settings).
 *
 * Labels are i18n keys, not strings, so each menu translates them with its
 * own `t`; the namespace each list expects is noted on it. Pair a list with
 * `localizeMenuOptions` to get `{ value, label }` pill options.
 */
import {
  type IconSvgElement,
  MonitorIcon,
  MoonIcon,
  Sun01Icon,
} from "@src/icons";

import { APPEARANCE_MODE, type AppearanceMode } from "./globalThemes";

interface MenuOptionDescriptor<T extends string> {
  value: T;
  labelKey: string;
}

/** Spotlight panel placement. Label keys live in the `settings` namespace. */
export const SPOTLIGHT_PLACEMENT_OPTIONS = [
  { value: "top", labelKey: "general.spotlightPlacementOptions.top" },
  { value: "center", labelKey: "general.spotlightPlacementOptions.center" },
] as const satisfies readonly MenuOptionDescriptor<string>[];

/** Left/right side for a docked panel. Label keys live in the `common` namespace. */
export const SIDE_POSITION_OPTIONS = [
  { value: "left", labelKey: "layoutSettings.left" },
  { value: "right", labelKey: "layoutSettings.right" },
] as const satisfies readonly MenuOptionDescriptor<string>[];

/** Glyph for each appearance mode in icon-only theme pills. */
export const APPEARANCE_MODE_ICONS: Record<AppearanceMode, IconSvgElement> = {
  [APPEARANCE_MODE.SYSTEM]: MonitorIcon,
  [APPEARANCE_MODE.LIGHT]: Sun01Icon,
  [APPEARANCE_MODE.DARK]: MoonIcon,
};

/** Translate a descriptor list into `{ value, label }` pill options. */
export function localizeMenuOptions<T extends string>(
  options: readonly MenuOptionDescriptor<T>[],
  t: (key: string) => string
): { value: T; label: string }[] {
  return options.map((option) => ({
    value: option.value,
    label: t(option.labelKey),
  }));
}
