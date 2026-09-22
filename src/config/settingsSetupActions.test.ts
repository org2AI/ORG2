import { createInstance } from "i18next";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  KEY_SETUP_PROVIDERS,
  buildSettingsSetupActions,
  parseSettingsSetupProvider,
} from "./settingsSetupActions";

const localeRoot = resolve(__dirname, "../i18n/locales");
const locales = readdirSync(localeRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

describe("settings setup entry points", () => {
  it.each(locales)(
    "uses translated action labels and round-trips setup intent in %s",
    async (locale) => {
      const i18n = createInstance();
      await i18n.init({
        lng: locale,
        fallbackLng: false,
        resources: {
          [locale]: {
            integrations: JSON.parse(
              readFileSync(
                resolve(localeRoot, locale, "integrations.json"),
                "utf8"
              )
            ),
          },
        },
        initImmediate: false,
      });
      const actions = buildSettingsSetupActions(i18n.t);
      for (const action of actions) {
        expect(action.label).not.toMatch(
          /cliPreview\.|integrations\.|gitConnections\.|projectConnections\./
        );
        const url = new URL(action.path, "http://localhost");
        const intent = parseSettingsSetupProvider(url.search);
        if (action.id.startsWith("add-key-"))
          expect(intent.keyProvider).toBe(action.id.slice(8));
        if (action.id.startsWith("connect-"))
          expect(intent.connectionProvider).toBe(action.id.slice(8));
      }
      expect(
        actions.filter((action) => action.id.startsWith("add-key-"))
      ).toHaveLength(KEY_SETUP_PROVIDERS.length);
    }
  );
  it("rejects unknown providers and mismatched or closed wizards", () => {
    for (const search of [
      "?setupProvider=github",
      "?wizard=key-add&setupProvider=github",
      "?wizard=channel-add&setupProvider=openai_api",
      "?wizard=key-add&setupProvider=unknown",
    ]) {
      expect(parseSettingsSetupProvider(search)).toEqual({
        keyProvider: undefined,
        connectionProvider: undefined,
      });
    }
  });
});
