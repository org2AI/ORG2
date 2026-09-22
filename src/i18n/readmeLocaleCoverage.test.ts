import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { SUPPORTED_LANGUAGES } from "./index";

/**
 * Adding a locale to SUPPORTED_LANGUAGES ships a translated UI but does not
 * ship the translated README, and changes to the English one do not reach the
 * translations. Both gaps are invisible in review, so they are asserted here:
 * the README set is the public face of every locale the app claims to support.
 */

/** Display name shown in the language switcher, per locale. */
const SWITCHER_LABELS: Record<string, string> = {
  en: "English",
  fr: "Français",
  zh: "简体中文",
  "zh-Hant": "繁體中文",
  es: "Español",
  hi: "हिन्दी",
  ru: "Русский",
  pt: "Português",
  de: "Deutsch",
  ja: "日本語",
  ko: "한국어",
  tr: "Türkçe",
  vi: "Tiếng Việt",
  id: "Bahasa Indonesia",
  pl: "Polski",
};

/** Every locale whose README lives under docs/readmes/. */
const TRANSLATED_LANGUAGES = SUPPORTED_LANGUAGES.filter(
  (locale) => locale !== "en"
);

const repoPath = (...segments: string[]) => resolve(process.cwd(), ...segments);

const readmePath = (locale: string) =>
  locale === "en"
    ? repoPath("README.md")
    : repoPath("docs/readmes", `README.${locale}.md`);

const readReadme = (locale: string) => readFileSync(readmePath(locale), "utf8");

const packageVersion = (): string =>
  JSON.parse(readFileSync(repoPath("package.json"), "utf8")).version;

/** Agent CLI documentation links, which must be the same set in every locale. */
const agentLinks = (readme: string): string[] => {
  const hrefs = readme.match(/<a href="(https?:\/\/[^"]+)"><kbd>/g) ?? [];
  return hrefs
    .map((match) => match.replace(/^<a href="/, "").replace(/"><kbd>$/, ""))
    .sort();
};

/** Locales listed in the switcher row, in the order they are rendered. */
const switcherLocales = (readme: string): string[] => {
  const row = readme
    .split("\n")
    .find((line) => line.includes(">English</a>") && line.includes("·"));
  expect(row, "language switcher row").toBeDefined();
  return (row as string)
    .split("·")
    .map((cell) => cell.match(/>([^<]+)<\/a>/)?.[1]?.trim())
    .map((label) =>
      Object.keys(SWITCHER_LABELS).find(
        (locale) => SWITCHER_LABELS[locale] === label
      )
    )
    .filter((locale): locale is string => Boolean(locale));
};

describe("README coverage for supported locales", () => {
  it("labels every supported language in the switcher", () => {
    expect(Object.keys(SWITCHER_LABELS).sort()).toEqual(
      [...SUPPORTED_LANGUAGES].sort()
    );
  });

  it.each(SUPPORTED_LANGUAGES)("ships a README for %s", (locale) => {
    expect(() => readReadme(locale)).not.toThrow();
  });

  it.each(SUPPORTED_LANGUAGES)(
    "lists every supported language, in order, in the %s README",
    (locale) => {
      expect(switcherLocales(readReadme(locale))).toEqual([
        ...SUPPORTED_LANGUAGES,
      ]);
    }
  );

  it("states the current build version in the English README", () => {
    const version = readReadme("en").match(
      /v(\d+\.\d+\.\d+) \(\d{4}-\d{2}-\d{2}\)/
    );
    expect(version?.[1], "build version line").toBe(packageVersion());
  });

  // Only the English README is versioned, so marking a release stays a
  // one-file edit. A version copied into a translation would go stale the
  // next time it is bumped, which is exactly how these files drifted before.
  it.each(TRANSLATED_LANGUAGES)(
    "leaves versioning to the English README in %s",
    (locale) => {
      expect(readReadme(locale)).not.toMatch(/v\d+\.\d+\.\d+/);
    }
  );

  it.each(SUPPORTED_LANGUAGES)(
    "offers the same agent CLI links in the %s README",
    (locale) => {
      expect(agentLinks(readReadme(locale))).toEqual(
        agentLinks(readReadme("en"))
      );
    }
  );

  it.each(SUPPORTED_LANGUAGES)(
    "uses the current brand name in the %s README",
    (locale) => {
      const readme = readReadme(locale);
      expect(readme).not.toMatch(/ORG-II/);
      expect(readme).not.toMatch(/ORGII/);
    }
  );
});
