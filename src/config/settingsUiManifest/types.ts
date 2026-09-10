import type { ComponentType } from "react";

import type { RenderableIcon } from "@src/components/AnyIcon";
import type { SettingsKey } from "@src/config/settingsSchema";
import type { SettingsSectionSlotId } from "@src/config/settingsUiManifest/slotIds";

/** App sections render controls; integration entries track settings-key coverage. */
export type SettingsTabId = "app" | "integrations";

export interface SettingsSectionDefinition {
  id: string;
  tab: SettingsTabId;
  labelKey: string;
  headingTitleKey: string;
  /** Glyph data or a brand component — render via `AnyIcon`. */
  icon: RenderableIcon;
  customSectionSlotId?: SettingsSectionSlotId;
  /**
   * Schema-backed keys covered by the section or integration surface.
   */
  coveredKeys?: SettingsKey[];
}

interface SettingsCustomSectionSlotProps {
  activeTab?: string;
}

export type SettingsCustomSectionSlot =
  ComponentType<SettingsCustomSectionSlotProps>;
