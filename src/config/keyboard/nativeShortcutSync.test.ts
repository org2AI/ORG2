import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";

import { syncNativeShortcuts } from "./nativeShortcutSync";
import { resolvedBindings } from "./shortcutBindings";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@src/util/platform/tauri", () => ({ isTauriDesktop: () => true }));

it("coalesces rapid native updates into one in-flight request and one latest snapshot", async () => {
  let finish!: () => void;
  invoke
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    )
    .mockResolvedValue(undefined);
  const first = syncNativeShortcuts();
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
  const pending = Array.from({ length: 30 }, () => syncNativeShortcuts());
  expect(invoke).toHaveBeenCalledOnce();
  finish();
  await Promise.all([first, ...pending]);
  expect(invoke).toHaveBeenCalledTimes(2);
  expect(invoke.mock.calls[1][1].forwarded.openFilePalette).toEqual(
    resolvedBindings("quick_open")
  );
});

it("forwards customized embedded-webview keys, suppresses replaced defaults, and respects recording", () => {
  const source = readFileSync(
    "src-tauri/crates/browser/src/scripts/shortcut_forwarding.rs",
    "utf8"
  );
  const script = source.split('r#"')[1].split('"#;')[0];
  let keydown!: (event: unknown) => void;
  const emit = vi.fn();
  const window = {
    __ORGII_SHORTCUT_PREFERENCES__: {
      bindings: {
        openFilePalette: [
          { key: "F6", ctrl: true, meta: false, alt: false, shift: false },
        ],
      },
      recording: false,
    },
    __TAURI__: { event: { emit } },
    addEventListener: (_: string, callback: typeof keydown) => {
      keydown = callback;
    },
  };
  runInNewContext(script, { window });
  const press = (key: string, code: string) =>
    keydown({
      key,
      code,
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    });
  press("p", "KeyP");
  expect(emit).not.toHaveBeenCalled();
  press("F6", "F6");
  expect(emit).toHaveBeenCalledWith("inline-webview-shortcut", {
    shortcut: "openFilePalette",
    keys: "",
  });
  emit.mockClear();
  window.__ORGII_SHORTCUT_PREFERENCES__.recording = true;
  press("F6", "F6");
  expect(emit).not.toHaveBeenCalled();
});
