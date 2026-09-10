import { describe, expect, it } from "vitest";

import { categoryToTabHost, tabToHost, tabTypeToTabHost } from "./tabHost";
import { DEFAULT_CATEGORY_BY_TYPE, defineTabFactory } from "./tabs/tabFactory";
import type { WorkStationTabType } from "./tabs/types";

describe("tab host routing", () => {
  it.each(Object.keys(DEFAULT_CATEGORY_BY_TYPE) as WorkStationTabType[])(
    "routes restored %s tabs to the same host as freshly created tabs",
    (type) => {
      const factory = defineTabFactory<Record<string, never>>({
        tabType: type,
        idStrategy: { type: "singleton", id: "routing-test" },
        getTitle: () => "Routing test",
      });
      const tab = factory({});
      const restored = { ...tab, category: undefined };
      expect(tabToHost(restored)).toBe(tabToHost(tab));
      expect(tabTypeToTabHost(type)).toBe(categoryToTabHost(tab.category));
    }
  );

  it("preserves explicit category overrides", () => {
    expect(
      tabToHost({
        id: "custom",
        type: "file",
        category: "browser",
        title: "Custom",
        data: {},
      })
    ).toBe("browser");
    expect(tabTypeToTabHost("file")).toBe("code");
    expect(tabTypeToTabHost("browser-session")).toBe("browser");
    expect(tabTypeToTabHost("project-workitems")).toBe("project");
  });
});
