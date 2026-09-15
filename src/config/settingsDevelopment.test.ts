import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("development settings build boundary", () => {
  it.each(["development", "production", "test"])(
    "gates navigation and direct routes in %s",
    async (mode) => {
      vi.stubEnv("NODE_ENV", mode);
      vi.resetModules();
      const { buildSettingsNavigationGroups } =
        await import("./settingsNavigation");
      const { parseCoreSettingsItem } = await import("./mainAppPaths/settings");
      const { getSettingsSectionById } = await import("./settingsUiManifest");
      for (const preference of [false, true]) {
        const items = buildSettingsNavigationGroups(
          (key) => key,
          preference
        ).flatMap((group) => group.items);
        expect(items.some((item) => item.id === "development")).toBe(
          mode === "development"
        );
      }
      expect(Boolean(getSettingsSectionById("development"))).toBe(
        mode === "development"
      );
      expect(
        parseCoreSettingsItem("/orgii/app/settings/app/development").section
      ).toBe(mode === "development" ? "development" : null);
    }
  );
});
