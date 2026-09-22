import { createInstance } from "i18next";
import { describe, expect, it } from "vitest";

import type { WorkStationTab } from "@src/store/workstation/tabs";

import { getWorkstationTabDisplayTitle } from "./WorkstationTabContent";

describe("search tab title", () => {
  it("uses the current locale and ignores stored query titles", async () => {
    const i18n = createInstance();
    await i18n.init({
      lng: "en",
      resources: {
        en: { common: { tabs: { search: "Search" } } },
        zh: { common: { tabs: { search: "搜索" } } },
      },
    });
    const tab: WorkStationTab = {
      id: "search:1",
      type: "search",
      title: "Search: old query",
      data: { initialQuery: "another query" },
    };
    expect(getWorkstationTabDisplayTitle(tab, i18n.t)).toBe("Search");
    await i18n.changeLanguage("zh");
    expect(getWorkstationTabDisplayTitle(tab, i18n.t)).toBe("搜索");
  });
});
