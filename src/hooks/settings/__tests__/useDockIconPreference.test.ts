import { describe, expect, it, vi } from "vitest";

import {
  getSettingsDefaults,
  validateSettings,
} from "@src/config/settingsSchema";

import { pushDockIcon } from "../useDockIconPreference";

describe("dock icon preference", () => {
  it("defaults to the bundled dark icon and accepts the light variant", () => {
    expect(getSettingsDefaults()["general.dockIcon"]).toBe("dark");
    expect(
      validateSettings({ "general.dockIcon": "light" })["general.dockIcon"]
    ).toBe("light");
  });

  it("falls back to the default for an unknown stored value", () => {
    expect(
      validateSettings({ "general.dockIcon": "inverted" })["general.dockIcon"]
    ).toBe("dark");
  });

  it("preserves the rainbow variant through settings validation", () => {
    expect(
      validateSettings({ "general.dockIcon": "rainbow" })["general.dockIcon"]
    ).toBe("rainbow");
  });

  it.each(["dark", "light", "rainbow"] as const)(
    "hands %s to the set_dock_icon command",
    async (variant) => {
      const invoke = vi.fn().mockResolvedValue(undefined);

      await pushDockIcon(variant, invoke);

      expect(invoke).toHaveBeenCalledTimes(1);
      expect(invoke).toHaveBeenCalledWith("set_dock_icon", { variant });
    }
  );

  it("swallows a missing native bridge instead of throwing", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("no tauri"));

    await expect(pushDockIcon("light", invoke)).resolves.toBeUndefined();
  });
});
