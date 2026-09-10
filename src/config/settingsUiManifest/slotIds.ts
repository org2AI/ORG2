export const SETTINGS_SECTION_SLOT_IDS = {
  APP_GENERAL: "app.general",
  APP_APPEARANCE: "app.appearance",
  APP_EDITOR: "app.editor",
  APP_SECURITY: "app.security",
  APP_MOBILE_REMOTE: "app.mobileRemote",

  APP_HARNESS_CONNECTIONS: "app.harnessConnections",
} as const;

export type SettingsSectionSlotId =
  (typeof SETTINGS_SECTION_SLOT_IDS)[keyof typeof SETTINGS_SECTION_SLOT_IDS];
