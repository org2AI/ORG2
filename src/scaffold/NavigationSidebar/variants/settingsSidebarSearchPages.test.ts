import { describe, expect, it } from "vitest";

import { buildSettingsNavigationGroups } from "@src/config/settingsNavigation";
import { buildGlobalSettingsSearchGroups } from "@src/config/settingsSearch";

import { buildSettingsSidebarSearchPages } from "./settingsSidebarSearchPages";

describe("settings sidebar page catalog", () => {
  const translate = (key: string) => key;
  const navigation = buildSettingsNavigationGroups(translate, true);
  const catalog = buildGlobalSettingsSearchGroups(translate, navigation);

  it("groups every destination and schema control exactly once under its owning page", () => {
    const pages = buildSettingsSidebarSearchPages(
      navigation,
      catalog,
      [],
      "general",
      "/general"
    );
    expect(pages.map(({ page }) => page.id)).toEqual(
      navigation.flatMap((group) => group.items.map((item) => item.id))
    );
    const controls = pages.flatMap((page) =>
      page.items.filter((item) => item.kind === "control")
    );
    expect(controls.map((item) => item.id).sort()).toEqual(
      catalog.flatMap((group) => group.items.map((item) => item.id)).sort()
    );
    for (const group of catalog) {
      for (const item of group.items) {
        expect(
          pages.find((page) => page.page.id === item.navigationItem.id)?.items
        ).toContainEqual(
          expect.objectContaining({
            id: item.id,
            path: item.path,
            searchKey: item.key,
          })
        );
      }
    }
  });

  it("deduplicates mounted schema rows and retains the exact current tab for extra controls", () => {
    const path = "/orgii/app/settings/app/appearance/code-editor";
    const pages = buildSettingsSidebarSearchPages(
      navigation,
      catalog,
      [
        {
          targetId: "duplicate",
          label: "Font size",
          searchKeys: ["editor.fontSize"],
        },
        {
          targetId: "extra",
          label: "Preview",
          description: "Editor preview",
          searchKeys: [],
        },
      ],
      "appearance",
      path
    );
    const appearance = pages.find((page) => page.page.id === "appearance");
    expect(appearance?.items).toContainEqual(
      expect.objectContaining({
        id: "extra",
        path,
        targetId: "extra",
        searchTerms: ["Editor preview"],
      })
    );
    expect(
      pages
        .flatMap((page) => page.items)
        .some((item) => item.id === "duplicate")
    ).toBe(false);
    expect(
      catalog
        .flatMap((group) => group.items)
        .some((item) => item.id === "extra")
    ).toBe(false);
  });
});
