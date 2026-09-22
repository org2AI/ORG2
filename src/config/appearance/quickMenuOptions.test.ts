import { describe, expect, it } from "vitest";

import { MonitorIcon, MoonIcon, Sun01Icon } from "@src/icons";

import {
  APPEARANCE_MODE_ICONS,
  SIDE_POSITION_OPTIONS,
  SPOTLIGHT_PLACEMENT_OPTIONS,
  localizeMenuOptions,
} from "./quickMenuOptions";

describe("quickMenuOptions", () => {
  it("localizes descriptor lists with the caller's translator", () => {
    const t = (key: string) => `t(${key})`;

    expect(localizeMenuOptions(SIDE_POSITION_OPTIONS, t)).toEqual([
      { value: "left", label: "t(layoutSettings.left)" },
      { value: "right", label: "t(layoutSettings.right)" },
    ]);
    expect(localizeMenuOptions(SPOTLIGHT_PLACEMENT_OPTIONS, t)).toEqual([
      { value: "top", label: "t(general.spotlightPlacementOptions.top)" },
      {
        value: "center",
        label: "t(general.spotlightPlacementOptions.center)",
      },
    ]);
  });

  it("maps each appearance mode to its theme glyph", () => {
    expect(APPEARANCE_MODE_ICONS).toEqual({
      system: MonitorIcon,
      light: Sun01Icon,
      dark: MoonIcon,
    });
  });
});
