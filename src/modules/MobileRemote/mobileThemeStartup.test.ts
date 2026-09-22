// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it } from "vitest";

const mobileHtml = readFileSync(
  path.resolve(process.cwd(), "public/mobile.html"),
  "utf8"
);
const parsedMobileHtml = new DOMParser().parseFromString(
  mobileHtml,
  "text/html"
);
const preflightScript =
  parsedMobileHtml.querySelector("script:not([src])")?.textContent;
const themeLinks = Array.from(
  parsedMobileHtml.querySelectorAll<HTMLLinkElement>(
    "link[data-orgii-mobile-theme]"
  )
);

// Execute the tracked bootstrap script with only its browser dependencies.
function runPreflight() {
  expect(preflightScript).toBeTruthy();
  runInNewContext(preflightScript!, {
    window,
    document,
    localStorage,
    getComputedStyle: window.getComputedStyle.bind(window),
  });
}

afterEach(() => {
  localStorage.clear();
  document.head.innerHTML = "";
  document.documentElement.className = "";
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-theme-id");
  document.documentElement.style.colorScheme = "";
  document.documentElement.style.removeProperty("--color-chat-container");
});

describe("mobile theme startup preflight", () => {
  it("derives browser chrome from the loaded canvas rather than a fixed palette", () => {
    themeLinks.forEach((link) => document.head.append(link.cloneNode(true)));
    localStorage.setItem("mobileRemote.theme", "dark");
    window.matchMedia = () => ({ matches: false }) as MediaQueryList;
    runPreflight();
    expect(document.querySelector('meta[name="theme-color"]')).toBeNull();
    document.documentElement.style.setProperty(
      "--color-chat-container",
      "#202020"
    );
    document
      .querySelector('link[data-orgii-mobile-theme="dark"]')!
      .dispatchEvent(new Event("load"));
    expect(
      document
        .querySelector('meta[name="theme-color"]')
        ?.getAttribute("content")
    ).toBe("#202020");
  });
  it.each([
    { preference: "dark", systemDark: false, expected: "dark" },
    { preference: "light", systemDark: true, expected: "light" },
    { preference: "system", systemDark: true, expected: "dark" },
    { preference: undefined, systemDark: true, expected: "dark" },
    { preference: undefined, systemDark: false, expected: "light" },
    { preference: "invalid", systemDark: false, expected: "light" },
  ])(
    "resolves $preference with systemDark=$systemDark before React mounts",
    ({ preference, systemDark, expected }) => {
      expect(preflightScript).toBeTruthy();
      themeLinks.forEach((link) => document.head.append(link.cloneNode(true)));
      // A conflicting Desktop preference must never affect mobile startup.
      const desktopPreference = expected === "dark" ? "light" : "dark";
      localStorage.setItem("theme", desktopPreference);
      if (preference) localStorage.setItem("mobileRemote.theme", preference);
      window.matchMedia = () => ({ matches: systemDark }) as MediaQueryList;

      runPreflight();

      const root = document.documentElement;
      const activeThemes = Array.from(
        document.querySelectorAll<HTMLLinkElement>(
          "link[data-orgii-mobile-theme]"
        )
      )
        .filter((link) => link.media === "all")
        .map((link) => link.dataset.orgiiMobileTheme);
      expect(activeThemes).toEqual([expected]);
      expect(localStorage.getItem("theme")).toBe(desktopPreference);
      expect(root.dataset.theme).toBe(expected);
      expect(root.dataset.themeId).toBe(expected);
      expect(root.style.colorScheme).toBe(expected);
      expect(root.classList.contains("theme-dark")).toBe(expected === "dark");
    }
  );
});
