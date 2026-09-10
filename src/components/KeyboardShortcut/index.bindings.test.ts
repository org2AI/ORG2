// @vitest-environment jsdom
import { act, createElement } from "react";
import { expect, it } from "vitest";

import {
  CURRENT_SHORTCUT_PLATFORM,
  resetShortcutBindings,
  setShortcutBinding,
} from "@src/config/keyboard/shortcutBindings";
import { createSmokeRoot } from "@src/test/reactSmokeHarness";

import { KeyboardShortcutTooltipContent } from "./index";

it("updates an already-mounted tooltip when its binding changes or resets", async () => {
  const root = createSmokeRoot();
  try {
    await root.render(
      createElement(KeyboardShortcutTooltipContent, {
        label: "New session",
        shortcutId: "new_session",
      })
    );
    expect(root.container.textContent).toContain("N");
    act(() =>
      setShortcutBinding("new_session", CURRENT_SHORTCUT_PLATFORM, {
        key: "F6",
        ctrl: true,
        meta: false,
        alt: false,
        shift: true,
      })
    );
    expect(root.container.textContent).toContain("F6");
    act(() => resetShortcutBindings());
    expect(root.container.textContent).not.toContain("F6");
  } finally {
    await root.unmount();
    resetShortcutBindings();
  }
});
