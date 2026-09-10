// @vitest-environment jsdom
import { createElement, useRef } from "react";
import { afterEach, expect, it, vi } from "vitest";

import {
  CURRENT_SHORTCUT_PLATFORM,
  resetShortcutBindings,
  setRecordingShortcut,
  setShortcutBinding,
} from "@src/config/keyboard/shortcutBindings";
import { createSmokeRoot } from "@src/test/reactSmokeHarness";

import { useVoiceShortcut } from "./useVoiceShortcut";

afterEach(() => {
  resetShortcutBindings();
  setRecordingShortcut(false);
});

it("uses remapped push-to-talk in both composers and retains the active press across renders", async () => {
  const start = vi.fn();
  const stop = vi.fn();
  function Composer({ enabled = true }: { enabled?: boolean }) {
    const ref = useRef<HTMLDivElement>(null);
    useVoiceShortcut(ref, enabled, { start, stop });
    // createElement attaches this ref at commit; it does not read it during render.
    // eslint-disable-next-line react-hooks/refs
    return createElement("div", { ref });
  }
  const root = createSmokeRoot();
  try {
    setShortcutBinding("voice_input", CURRENT_SHORTCUT_PLATFORM, {
      key: "F6",
      ctrl: false,
      meta: false,
      alt: true,
      shift: false,
    });
    await root.render(createElement(Composer));
    const down = (key: string, init: KeyboardEventInit = {}) =>
      root.container.firstChild!.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, ...init })
      );
    down("m", { ctrlKey: true });
    expect(start).not.toHaveBeenCalled();
    down("F6", { altKey: true });
    expect(start).toHaveBeenCalledTimes(1);
    await root.render(createElement(Composer));
    expect(stop).not.toHaveBeenCalled();
    down("F6", { altKey: true, repeat: true });
    expect(start).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "x" }));
    expect(stop).not.toHaveBeenCalled();
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt" }));
    expect(stop).toHaveBeenCalledTimes(1);
    down("F6", { altKey: true });
    window.dispatchEvent(new Event("blur"));
    expect(stop).toHaveBeenCalledTimes(2);
    setRecordingShortcut(true);
    down("F6", { altKey: true });
    expect(start).toHaveBeenCalledTimes(2);
    setRecordingShortcut(false);
    down("F6", { altKey: true });
    await root.render(createElement(Composer, { enabled: false }));
    expect(stop).toHaveBeenCalledTimes(3);
    down("F6", { altKey: true });
    expect(start).toHaveBeenCalledTimes(3);
  } finally {
    await root.unmount();
  }
});
