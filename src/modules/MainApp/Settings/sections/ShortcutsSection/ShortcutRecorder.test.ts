// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import {
  getShortcutOverrides,
  isRecordingShortcut,
  resetShortcutBindings,
} from "@src/config/keyboard/shortcutBindings";
import { getShortcutKeys } from "@src/config/keyboard/shortcutDisplay";

import ShortcutRecorder from "./ShortcutRecorder";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

vi.mock("@src/config/keyboard/nativeShortcutSync", () => ({
  syncNativeShortcuts: () => Promise.resolve(),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => resetShortcutBindings());

it("records, updates its badge, resets, cancels, and releases capture on unmount", async () => {
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  function Harness() {
    const [recording, setRecording] = useState<string | null>(null);
    return createElement(ShortcutRecorder, {
      id: "new_session",
      command: "New session",
      platform: "windows",
      recording: recording === "new_session",
      onRecord: setRecording,
    });
  }
  await act(async () => root.render(createElement(Harness)));
  const click = async (index: number) => {
    await act(async () => {
      node.querySelectorAll("button")[index].click();
    });
  };
  const press = async (key: string) => {
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key,
          code: key,
          ctrlKey: key !== "Escape",
          bubbles: true,
          cancelable: true,
        })
      );
    });
  };
  try {
    await click(0);
    expect(isRecordingShortcut()).toBe(true);
    await press("F6");
    expect(isRecordingShortcut()).toBe(false);
    expect(getShortcutKeys("new_session", { platform: "windows" })).toBe(
      "Ctrl+F6"
    );
    expect(node.textContent).toContain("F6");
    await click(1);
    expect(getShortcutOverrides()).toEqual({});
    await click(0);
    await press("Escape");
    expect(getShortcutOverrides()).toEqual({});
    expect(isRecordingShortcut()).toBe(false);
    await click(0);
  } finally {
    await act(async () => root.unmount());
    node.remove();
  }
  expect(isRecordingShortcut()).toBe(false);
});
