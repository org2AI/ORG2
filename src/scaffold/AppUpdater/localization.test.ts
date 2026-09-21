import { createInstance } from "i18next";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { SUPPORTED_LANGUAGES } from "@src/i18n";
import enSettings from "@src/i18n/locales/en/settings.json";

function readNamespace(language: string, namespace: string) {
  return JSON.parse(
    readFileSync(
      resolve("src/i18n/locales", language, `${namespace}.json`),
      "utf8"
    )
  );
}

describe("Update localization completeness", () => {
  it.each(SUPPORTED_LANGUAGES)(
    "resolves every update message in %s without fallback",
    async (language) => {
      const settings = readNamespace(language, "settings");
      const translator = createInstance();
      await translator.init({
        lng: language,
        fallbackLng: false,
        resources: {
          [language]: {
            settings,
            common: readNamespace(language, "common"),
            navigation: readNamespace(language, "navigation"),
            integrations: readNamespace(language, "integrations"),
            sessions: readNamespace(language, "sessions"),
          },
        },
        interpolation: { escapeValue: false },
      });
      const values = {
        version: "2.0.0",
        percent: 50,
        downloaded: "2 MB",
        total: "4 MB",
        progress: "50%",
        path: "/Applications/ORG2.app",
        error: "diagnostic",
      };
      for (const [key, english] of Object.entries(enSettings.update)) {
        const localized = settings.update[key];
        expect(typeof localized, `${language}:${key}`).toBe("string");
        expect(localized.trim().length, `${language}:${key}`).toBeGreaterThan(
          0
        );
        expect(
          localized.match(/{{.*?}}/g)?.sort() ?? [],
          `${language}:${key}`
        ).toEqual(english.match(/{{.*?}}/g)?.sort() ?? []);
        const fullKey = `settings:update.${key}`;
        expect(translator.exists(fullKey), fullKey).toBe(true);
        const rendered = translator.t(fullKey, values);
        expect(rendered).not.toContain("{{");
        expect(rendered).not.toBe(`update.${key}`);
      }
      for (const key of [
        "common:actions.retry",
        "common:errors.unknownError",
        "common:spotlightActions.detectUpdate",
        "sessions:chat.startPage.installLatestUpdate.title",
        "navigation:sidebar.bottomBar.updateAvailable",
        "integrations:agentOrgs.cliUpdateAlerts.label",
        "integrations:agentOrgs.cliUpdateAlerts.description",
      ]) {
        expect(translator.exists(key), `${language}:${key}`).toBe(true);
      }
    }
  );
});
