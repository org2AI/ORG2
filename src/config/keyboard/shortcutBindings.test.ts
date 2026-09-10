// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SHORTCUT_STORAGE_KEY,
  bindingFromEvent,
  defaultBindings,
  findShortcutConflict,
  formatBinding,
  getShortcutOverrides,
  matchesShortcut,
  parseBinding,
  resetShortcutBindings,
  sanitizeOverrides,
  setRecordingShortcut,
  setShortcutBinding,
  subscribeShortcutBindings,
} from "./shortcutBindings";
import { getShortcutAccelerator, getShortcutKeys } from "./shortcutDisplay";

const custom = { key: "F6", ctrl: true, meta: false, shift: true, alt: false };
beforeEach(() => {
  resetShortcutBindings();
  setRecordingShortcut(false);
});
afterEach(() => {
  vi.restoreAllMocks();
  resetShortcutBindings();
  setRecordingShortcut(false);
});

describe("shortcut preference producing boundary", () => {
  it("persists separate Windows, Linux, and macOS overrides and resolves labels", () => {
    setShortcutBinding("new_session", "windows", custom);
    setShortcutBinding("new_session", "linux", { ...custom, key: "F7" });
    setShortcutBinding("new_session", "mac", {
      ...custom,
      ctrl: false,
      meta: true,
    });
    expect(getShortcutKeys("new_session", { platform: "windows" })).toBe(
      "Ctrl+Shift+F6"
    );
    expect(getShortcutKeys("new_session", { platform: "linux" })).toBe(
      "Ctrl+Shift+F7"
    );
    expect(getShortcutKeys("new_session", { platform: "mac" })).toBe("⇧⌘ F6");
    expect(JSON.parse(localStorage.getItem(SHORTCUT_STORAGE_KEY)!)).toEqual(
      getShortcutOverrides()
    );
    expect(getShortcutAccelerator("new_session")).toBeTruthy();
  });
  it("rejects conflicts at the writer and leaves persisted data unchanged", () => {
    setShortcutBinding("new_session", "windows", custom);
    const saved = localStorage.getItem(SHORTCUT_STORAGE_KEY);
    expect(() =>
      setShortcutBinding("open_settings", "windows", custom)
    ).toThrow(/already used/);
    expect(findShortcutConflict("open_settings", "windows", custom)).toBe(
      "Create new session"
    );
    expect(localStorage.getItem(SHORTCUT_STORAGE_KEY)).toBe(saved);
  });
  it("rejects unknown commands, unsafe typing bindings, and invalid stored payloads", () => {
    expect(() => setShortcutBinding("unknown", "windows", custom)).toThrow();
    expect(() =>
      setShortcutBinding("new_session", "windows", {
        ...custom,
        key: "x",
        ctrl: false,
      })
    ).toThrow();
    expect(
      sanitizeOverrides({
        windows: {
          new_session: { ...custom, key: "UnknownKey" },
          unknown: custom,
        },
        mac: null,
      })
    ).toEqual({});
    expect(
      sanitizeOverrides({
        windows: { new_session: { ...custom, key: "x", ctrl: false } },
      })
    ).toEqual({});
  });
  it("resets one binding, one platform, and all platforms without copying defaults", () => {
    setShortcutBinding("new_session", "windows", custom);
    setShortcutBinding("open_settings", "windows", { ...custom, key: "F7" });
    setShortcutBinding("new_session", "linux", custom);
    resetShortcutBindings("windows", "new_session");
    expect(getShortcutKeys("new_session", { platform: "windows" })).toBe(
      "Ctrl+N"
    );
    resetShortcutBindings("windows");
    expect(getShortcutOverrides().windows).toBeUndefined();
    expect(getShortcutOverrides().linux).toBeDefined();
    resetShortcutBindings();
    expect(getShortcutOverrides()).toEqual({});
    expect(localStorage.getItem(SHORTCUT_STORAGE_KEY)).toBe("{}");
  });
  it("treats recording an original binding as reset and keeps command aliases coherent", () => {
    setShortcutBinding("spotlight_open", "windows", custom);
    expect(getShortcutKeys("toggle_spotlight", { platform: "windows" })).toBe(
      "Ctrl+Shift+F6"
    );
    setShortcutBinding(
      "spotlight_open",
      "windows",
      defaultBindings("toggle_spotlight", "windows")[0]
    );
    expect(Object.keys(getShortcutOverrides().windows ?? {})).toHaveLength(0);
  });
  it("does not publish an in-memory edit when storage fails", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
      throw new Error("quota");
    });
    expect(() => setShortcutBinding("new_session", "windows", custom)).toThrow(
      "quota"
    );
    expect(getShortcutOverrides()).toEqual({});
  });
  it("observes cross-window changes and releases the storage listener", () => {
    const notify = vi.fn();
    const remove = vi.spyOn(window, "removeEventListener");
    const unsubscribe = subscribeShortcutBindings(notify);
    localStorage.setItem(
      SHORTCUT_STORAGE_KEY,
      JSON.stringify({ windows: { new_session: custom } })
    );
    window.dispatchEvent(
      new StorageEvent("storage", { key: SHORTCUT_STORAGE_KEY })
    );
    expect(getShortcutOverrides().windows?.new_session).toEqual(custom);
    expect(notify).toHaveBeenCalledOnce();
    unsubscribe();
    expect(remove).toHaveBeenCalledWith("storage", expect.any(Function));
  });
});

describe("production key matching", () => {
  it.each(["mac", "windows", "linux"] as const)(
    "replaces rather than adds to the original %s binding",
    (platform) => {
      const binding = {
        ...custom,
        ctrl: platform !== "mac",
        meta: platform === "mac",
      };
      setShortcutBinding("new_session", platform, binding);
      expect(
        matchesShortcut(
          new KeyboardEvent("keydown", {
            key: "F6",
            code: "F6",
            ctrlKey: binding.ctrl,
            metaKey: binding.meta,
            shiftKey: true,
          }),
          "new_session",
          platform
        )
      ).toBe(true);
      expect(
        matchesShortcut(
          new KeyboardEvent("keydown", {
            key: "n",
            code: "KeyN",
            ctrlKey: binding.ctrl,
            metaKey: binding.meta,
          }),
          "new_session",
          platform
        )
      ).toBe(false);
    }
  );
  it("checks exact modifiers and ignores recording, IME, and AltGraph", () => {
    const event = new KeyboardEvent("keydown", {
      key: "n",
      code: "KeyN",
      ctrlKey: true,
    });
    expect(matchesShortcut(event, "new_session", "windows")).toBe(true);
    expect(
      matchesShortcut(
        new KeyboardEvent("keydown", { key: "n", ctrlKey: true, altKey: true }),
        "new_session",
        "windows"
      )
    ).toBe(false);
    setRecordingShortcut(true);
    expect(matchesShortcut(event, "new_session", "windows")).toBe(false);
    setRecordingShortcut(false);
    expect(
      matchesShortcut(
        new KeyboardEvent("keydown", {
          key: "n",
          ctrlKey: true,
          isComposing: true,
        }),
        "new_session",
        "windows"
      )
    ).toBe(false);
  });
  it("matches Option and shifted punctuation by physical key without changing aliases", () => {
    const event = new KeyboardEvent("keydown", {
      key: "{",
      code: "BracketLeft",
      metaKey: true,
      shiftKey: true,
    });
    expect(matchesShortcut(event, "chat_prev_tab", "mac")).toBe(true);
    expect(
      bindingFromEvent(
        new KeyboardEvent("keydown", {
          key: "Dead",
          code: "KeyE",
          altKey: true,
        })
      )?.key
    ).toBe("e");
    expect(formatBinding(parseBinding("⌥⌘B")!, "windows")).toBe("Alt+Meta+B");
    expect(
      matchesShortcut(
        new KeyboardEvent("keydown", {
          key: "+",
          code: "Equal",
          ctrlKey: true,
          shiftKey: true,
        }),
        "zoom_in",
        "windows"
      )
    ).toBe(true);
  });
});

it.each(["mac", "windows", "linux"] as const)(
  "replaces file aliases and captions on %s",
  (platform) => {
    const rename = new KeyboardEvent("keydown", { key: "F2" });
    expect(matchesShortcut(rename, "file_menu_rename", platform)).toBe(true);
    const deleteKey = new KeyboardEvent("keydown", {
      key: "Delete",
      metaKey: platform === "mac",
      ctrlKey: platform !== "mac",
    });
    expect(matchesShortcut(deleteKey, "file_menu_delete", platform)).toBe(true);
    for (const [id, old] of [
      ["file_menu_rename", rename],
      ["file_menu_delete", deleteKey],
    ] as const) {
      setShortcutBinding(id, platform, custom);
      expect(matchesShortcut(old, id, platform)).toBe(false);
      expect(
        matchesShortcut(
          new KeyboardEvent("keydown", {
            key: "F6",
            ctrlKey: true,
            shiftKey: true,
          }),
          id,
          platform
        )
      ).toBe(true);
      resetShortcutBindings(platform, id);
      expect(matchesShortcut(old, id, platform)).toBe(true);
    }
    setShortcutBinding("toggle_captions", platform, custom);
    expect(
      matchesShortcut(
        new KeyboardEvent("keydown", {
          key: "c",
          altKey: true,
          metaKey: platform === "mac",
          ctrlKey: platform !== "mac",
        }),
        "toggle_captions",
        platform
      )
    ).toBe(false);
  }
);
