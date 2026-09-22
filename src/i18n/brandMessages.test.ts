import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { SUPPORTED_LANGUAGES } from "./index";

const messages: Record<string, string[]> = {
  common: [
    "notifications.taskFailedPrivateBody",
    "appMessages.testNotificationBody",
    "appMessages.workspaceFile",
    "appMessages.sessionJsonFile",
    "appMessages.skillsSource",
    "appMessages.gitServiceUnavailable",
    "selectors.spotlight.toast.repoRemoved",
    "selectors.spotlight.toast.repoRemoveFailed",
    "selectors.spotlight.toast.workspaceRemoved",
    "selectors.spotlight.toast.workspaceRemoveFailed",
    "selectors.spotlight.toast.bulkDeleted",
  ],
  settings: [
    "update.upToDate",
    "update.upToDateVersion",
    "update.officialAlreadyInstalled",
    "update.automaticRetry",
    "update.restarting",
  ],
  sessions: ["creator.cursorIdeDescription"],
  integrations: ["channels.matrixDeviceNamePlaceholder"],
  navigation: [
    "launchpad.actions.remove",
    "launchpad.actions.removeSuccess",
    "launchpad.actions.removeFailed",
  ],
};

function readCatalog(locale: string, namespace: string) {
  return JSON.parse(
    readFileSync(
      resolve(process.cwd(), "src/i18n/locales", locale, `${namespace}.json`),
      "utf8"
    )
  );
}

function readMessage(catalog: Record<string, unknown>, path: string): string {
  let value: unknown = catalog;
  for (const key of path.split(".")) {
    value = (value as Record<string, unknown> | undefined)?.[key];
  }
  expect(typeof value, path).toBe("string");
  return value as string;
}

const tokens = (value: string) => value.match(/{{\w+}}/g)?.sort() ?? [];

describe("ORG2 user-facing message translations", () => {
  it.each(SUPPORTED_LANGUAGES)(
    "provides translated copy and interpolation tokens in %s",
    (locale) => {
      for (const [namespace, keys] of Object.entries(messages)) {
        const catalog = readCatalog(locale, namespace);
        const english = readCatalog("en", namespace);
        for (const key of keys) {
          const value = readMessage(catalog, key);
          const source = readMessage(english, key);
          expect(value, `${namespace}:${key}`).toContain("ORG2");
          expect(tokens(value), key).toEqual(tokens(source));
          if (locale !== "en") expect(value, key).not.toBe(source);
        }
      }
    }
  );
});
