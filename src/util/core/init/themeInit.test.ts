// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initTheme } from "./themeInit";

vi.mock("@src/util/platform/tauri", () => ({
  isMacOS: () => false,
  isWindows: () => false,
}));
vi.mock("@src/util/platform/macosRootTint", () => ({
  syncMacosRootTint: vi.fn(async () => {}),
}));
vi.mock("@src/util/platform/macosPageBackdrop", () => ({
  syncMacosPageBackdrop: vi.fn(),
}));

function themeLinks(): HTMLLinkElement[] {
  return Array.from(document.querySelectorAll("link[data-orgii-theme]"));
}

function pendingDarkTheme(): HTMLLinkElement {
  const link = themeLinks().find((entry) =>
    entry.href.endsWith("/orgii_dark.css")
  );
  if (!link) throw new Error("missing pending dark stylesheet");
  return link;
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  document.head.innerHTML = "";
  delete document.documentElement.dataset.theme;
  // Use the real bootstrap markup: this guard must exist before JS runs.
  const html = fs.readFileSync(path.resolve("public/index.html"), "utf8");
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const baseline = parsed.querySelector(
    'link[data-orgii-theme][rel="stylesheet"]'
  );
  if (!baseline) throw new Error("startup HTML has no baseline stylesheet");
  document.head.appendChild(document.importNode(baseline, true));
  localStorage.setItem("theme", "system");
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("requestIdleCallback", () => 0);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("follow-device startup theme guard", () => {
  it("keeps the base theme until dark loads, even with animation frames suspended", async () => {
    const baseline = themeLinks()[0];
    const ready = initTheme();
    expect(baseline.isConnected).toBe(true);
    pendingDarkTheme().onload?.(new Event("load"));
    await vi.advanceTimersByTimeAsync(300);
    await ready;
    expect(themeLinks()).toHaveLength(1);
    expect(themeLinks()[0].href).toMatch(/\/orgii_dark.css$/);
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it.each(["error", "timeout"])(
    "retains one base stylesheet when system dark fails: %s",
    async (failure) => {
      const ready = initTheme();
      if (failure === "error") pendingDarkTheme().onerror?.(new Event("error"));
      await vi.advanceTimersByTimeAsync(4100);
      await ready;
      expect(themeLinks()).toHaveLength(1);
      expect(themeLinks()[0].href).toMatch(/\/orgii_main.css$/);
      expect(document.documentElement.dataset.theme).toBe("light");
      expect(localStorage.getItem("theme")).toBe("system");
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it("uses the existing base stylesheet when the device is light", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    await initTheme();
    await vi.advanceTimersByTimeAsync(300);
    expect(themeLinks()).toHaveLength(1);
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses the device theme on a first launch with no stored preference", async () => {
    localStorage.removeItem("theme");
    const ready = initTheme();
    pendingDarkTheme().onload?.(new Event("load"));
    await vi.advanceTimersByTimeAsync(300);
    await ready;
    expect(themeLinks()).toHaveLength(1);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("theme")).toBeNull();
  });
});
