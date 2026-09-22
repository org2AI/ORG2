import { describe, expect, it, vi } from "vitest";

import { createSettingsSearchIndex } from "./settingsSearchIndex";

describe("prepared settings search", () => {
  const groups = [
    {
      id: "appearance",
      items: [
        { id: "font", label: "Café 字体", searchTerms: ["editor font size"] },
        { id: "skin", label: "皮肤", searchTerms: ["theme"] },
      ],
    },
    { id: "empty", items: [] },
  ];

  it("matches localized labels, accents, aliases and all whitespace-separated tokens", () => {
    const search = createSettingsSearchIndex(groups);
    expect(search("ＣＡＦＥ editor")[0].items[0].id).toBe("font");
    expect(search("字体\tSIZE")[0].items[0].id).toBe("font");
    expect(search("皮肤")[0].items[0].id).toBe("skin");
    expect(search("font missing")).toEqual([]);
    expect(search("  ")).toEqual([groups[0]]);
    expect(groups[0].items).toHaveLength(2);
  });

  it("normalizes entry text once, regardless of how many queries are issued", () => {
    const normalize = vi.spyOn(String.prototype, "normalize");
    try {
      const search = createSettingsSearchIndex(groups);
      expect(normalize).toHaveBeenCalledTimes(2);
      normalize.mockClear();
      for (let index = 0; index < 100; index++) search(`font ${index}`);
      expect(normalize).toHaveBeenCalledTimes(100);
    } finally {
      normalize.mockRestore();
    }
  });
});
