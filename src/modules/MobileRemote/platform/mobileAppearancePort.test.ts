// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyMobileColorScheme,
  createMobileAppearancePort,
} from "./mobileAppearancePort";

function addThemeLink(colorScheme: "light" | "dark") {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.setAttribute("data-orgii-mobile-theme", colorScheme);
  document.head.append(link);
  return link;
}

describe("mobile appearance port", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.documentElement.className = "";
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-theme-id");
    document.documentElement.style.colorScheme = "";
    document.documentElement.style.removeProperty("--color-chat-container");
  });

  function appearanceWindow() {
    return {
      matchMedia: () => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    } as unknown as Window;
  }

  it("mirrors the loaded canvas into browser metadata and the native boundary", async () => {
    document.documentElement.style.setProperty(
      "--color-chat-container",
      "#202020"
    );
    const applyNative = vi.fn().mockResolvedValue(undefined);
    const port = createMobileAppearancePort(
      appearanceWindow(),
      document,
      applyNative
    );
    await port.applyColorScheme("dark");
    expect(
      document
        .querySelector('meta[name="theme-color"]')
        ?.getAttribute("content")
    ).toBe("#202020");
    expect(applyNative).toHaveBeenLastCalledWith([32, 32, 32]);
    document.documentElement.style.setProperty(
      "--color-chat-container",
      "#f2f2f2"
    );
    await port.applyColorScheme("light");
    expect(document.querySelectorAll('meta[name="theme-color"]')).toHaveLength(
      1
    );
    expect(applyNative).toHaveBeenLastCalledWith([242, 242, 242]);
  });

  it("coalesces rapid native writes and finishes with the latest canvas", async () => {
    let finish!: () => void;
    const firstWrite = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const applyNative = vi
      .fn()
      .mockReturnValueOnce(firstWrite)
      .mockResolvedValue(undefined);
    const port = createMobileAppearancePort(
      appearanceWindow(),
      document,
      applyNative
    );
    document.documentElement.style.setProperty(
      "--color-chat-container",
      "#202020"
    );
    const first = port.applyColorScheme("dark");
    document.documentElement.style.setProperty(
      "--color-chat-container",
      "#eeeeee"
    );
    const second = port.applyColorScheme("light");
    document.documentElement.style.setProperty(
      "--color-chat-container",
      "#f2f2f2"
    );
    const third = port.applyColorScheme("light");
    await Promise.resolve();
    expect(applyNative).toHaveBeenCalledTimes(1);
    finish();
    await Promise.all([first, second, third]);
    expect(applyNative.mock.calls).toEqual([[[32, 32, 32]], [[242, 242, 242]]]);
  });

  it("uses current tokens on a late stylesheet load and removes listeners on cleanup", async () => {
    const lateDark = addThemeLink("dark");
    const applyNative = vi.fn().mockResolvedValue(undefined);
    const port = createMobileAppearancePort(
      appearanceWindow(),
      document,
      applyNative
    );
    const cleanup = port.subscribeSystemColorScheme(vi.fn());
    await port.applyColorScheme("light");
    expect(applyNative).not.toHaveBeenCalled();
    document.documentElement.style.setProperty(
      "--color-chat-container",
      "#f2f2f2"
    );
    lateDark.dispatchEvent(new Event("load"));
    await Promise.resolve();
    expect(applyNative).toHaveBeenLastCalledWith([242, 242, 242]);
    cleanup();
    lateDark.dispatchEvent(new Event("load"));
    expect(applyNative).toHaveBeenCalledTimes(1);
  });

  it("reports native failure and allows the same theme to retry", async () => {
    document.documentElement.style.setProperty(
      "--color-chat-container",
      "#202020"
    );
    const applyNative = vi
      .fn()
      .mockRejectedValueOnce(new Error("native unavailable"))
      .mockResolvedValue(undefined);
    const port = createMobileAppearancePort(
      appearanceWindow(),
      document,
      applyNative
    );
    await expect(port.applyColorScheme("dark")).rejects.toThrow(
      "native unavailable"
    );
    await expect(port.applyColorScheme("dark")).resolves.toBeUndefined();
    expect(applyNative).toHaveBeenCalledTimes(2);
  });

  it("activates exactly one token stylesheet and synchronizes root semantics", () => {
    const light = addThemeLink("light");
    const dark = addThemeLink("dark");

    applyMobileColorScheme("dark", document);

    expect(light.media).toBe("not all");
    expect(dark.media).toBe("all");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.themeId).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(document.documentElement.classList.contains("theme-dark")).toBe(
      true
    );
  });

  it("owns one system listener and removes it on cleanup", () => {
    const listeners = new Set<() => void>();
    const queryState = {
      matches: false,
      addEventListener: vi.fn((_name: string, listener: () => void) =>
        listeners.add(listener)
      ),
      removeEventListener: vi.fn((_name: string, listener: () => void) =>
        listeners.delete(listener)
      ),
    };
    const query = queryState as unknown as MediaQueryList;
    const targetWindow = {
      matchMedia: vi.fn(() => query),
    } as unknown as Window;
    const port = createMobileAppearancePort(targetWindow, document);
    const onChange = vi.fn();

    const unsubscribe = port.subscribeSystemColorScheme(onChange);
    expect(listeners).toHaveLength(1);
    expect(port.getSystemColorScheme()).toBe("light");
    queryState.matches = true;
    listeners.forEach((listener) => listener());
    expect(onChange).toHaveBeenCalledWith("dark");

    unsubscribe();
    expect(listeners).toHaveLength(0);
  });
});
