import { createInstance } from "i18next";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import zhCommon from "@src/i18n/locales/zh/common.json";
import zhSettings from "@src/i18n/locales/zh/settings.json";

import { buildSettingsNavigationGroups } from "./settingsNavigation";
import {
  SETTINGS_REGISTRY,
  type SettingDefinition,
  getSettingsKeys,
} from "./settingsSchema";
import { buildGlobalSettingsSearchGroups } from "./settingsSearch";

const NAMESPACES: Record<string, unknown> = {
  common: zhCommon,
  settings: zhSettings,
};

function translate(key: string): string {
  const [namespace, nestedKey] = key.includes(":")
    ? key.split(":", 2)
    : ["settings", key];
  const value = nestedKey
    .split(".")
    .reduce<unknown>(
      (current, part) =>
        current && typeof current === "object"
          ? (current as Record<string, unknown>)[part]
          : undefined,
      NAMESPACES[namespace]
    );
  return typeof value === "string" ? value : key;
}

describe("global settings search catalog", () => {
  it("does not offer retired state or live configuration with no settings-page control", () => {
    const items = buildGlobalSettingsSearchGroups(
      translate,
      buildSettingsNavigationGroups(translate, true)
    ).flatMap((group) => group.items);
    const keys = items.map((item) => item.key);
    for (const key of [
      "general.setupWalkthroughProgress",
      "general.githubStarPromptCompleted",
      "general.githubStarPromptDisabled",
      "general.githubStarPromptDeferredUntil",
      "general.githubStarPromptLastShownAt",
      "general.githubStarPromptNextEligibleValueCount",
      "mobileRemote.desktopToken",
      "general.userDisplayName",
      "general.chatPanelPosition",
      "general.chatTurnPaginationEnabled",
      "general.modelPickerStyle",
      "privacy.diagnosticsLevel",
      "privacy.diagnosticsUploadIntervalHours",
      "privacy.offlineMode",
      "privacy.shareRuntimeWithOrg",
      "editor.showIndentGuides",
      "editor.showBlame",
      "terminal.letterSpacing",
      "mobileRemote.desktopId",
      "mobileRemote.allowLanExposure",
      "mobileRemote.lanToken",
      "mobileRemote.lanPort",
    ]) {
      expect(keys).not.toContain(key);
    }
    expect(keys).toContain("general.language");
    expect(keys).toContain("git.autoFetch");
    expect(keys).toContain("housekeeper.enabled");
  });

  it("indexes each settings-page control once and excludes non-page configuration", () => {
    const navigationGroups = buildSettingsNavigationGroups(translate, true);
    const items = buildGlobalSettingsSearchGroups(
      translate,
      navigationGroups
    ).flatMap((group) => group.items);

    expect(items.map((item) => item.key).sort()).toEqual(
      getSettingsKeys()
        .filter(
          (key) =>
            (SETTINGS_REGISTRY[key] as SettingDefinition).settingsSearch !==
            false
        )
        .sort()
    );
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
  });

  it("keeps HTTP version searchable outside developer mode", () => {
    const items = buildGlobalSettingsSearchGroups(
      translate,
      buildSettingsNavigationGroups(translate, false)
    ).flatMap((group) => group.items);
    expect(
      items.find((item) => item.key === "network.httpVersion")
    ).toMatchObject({
      path: "/orgii/app/settings/app/general/general",
    });
  });

  it("localizes global results and sends appearance controls to their tab", () => {
    const navigationGroups = buildSettingsNavigationGroups(translate, true);
    const items = buildGlobalSettingsSearchGroups(
      translate,
      navigationGroups
    ).flatMap((group) => group.items);

    expect(
      items.find((item) => item.key === "general.primaryColorLight")
    ).toMatchObject({
      label: "浅色强调色",
      path: "/orgii/app/settings/app/appearance/app",
      searchTerms: expect.arrayContaining(["强调色"]),
    });
    expect(
      items.find((item) => item.key === "network.httpVersion")
    ).toMatchObject({
      path: "/orgii/app/settings/app/general/general",
    });
    expect(items.find((item) => item.key === "editor.fontSize")).toMatchObject({
      label: "字体大小",
      path: "/orgii/app/settings/app/appearance/code-editor",
    });
  });
});

const localeRoot = resolve(__dirname, "../i18n/locales");
const locales = readdirSync(localeRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

describe("settings catalog localization with real i18next", () => {
  it.each(locales)(
    "resolves every indexed label and alias in %s without language fallback",
    async (locale) => {
      const resources = Object.fromEntries(
        readdirSync(resolve(localeRoot, locale))
          .filter((name) => name.endsWith(".json"))
          .map((name) => [
            name.slice(0, -5),
            JSON.parse(readFileSync(resolve(localeRoot, locale, name), "utf8")),
          ])
      );
      const i18n = createInstance();
      await i18n.init({
        lng: locale,
        fallbackLng: false,
        resources: { [locale]: resources },
        ns: Object.keys(resources),
        defaultNS: "common",
        initImmediate: false,
      });
      const navigation = buildSettingsNavigationGroups(
        (key) => i18n.t(key),
        true
      );
      const missing: string[] = [];
      const groups = buildGlobalSettingsSearchGroups((key) => {
        if (!i18n.exists(key)) missing.push(key);
        return i18n.t(key);
      }, navigation);
      expect(missing).toEqual([]);
      expect(
        groups
          .flatMap((group) => group.items)
          .every((item) => item.label && !item.label.includes("{{"))
      ).toBe(true);
    }
  );

  it("does not mistake namespace-stripped missing keys for translations", async () => {
    const i18n = createInstance();
    await i18n.init({
      lng: "zh",
      fallbackLng: false,
      resources: {},
      initImmediate: false,
    });
    const navigation = buildSettingsNavigationGroups((key) => key, true);
    const items = buildGlobalSettingsSearchGroups(
      (key) => i18n.t(key),
      navigation
    ).flatMap((group) => group.items);
    expect(items.find((item) => item.key === "general.theme")?.label).toBe(
      "Theme"
    );
    expect(items.find((item) => item.key === "general.lightSkin")?.label).toBe(
      "Light Skin"
    );
  });
});
