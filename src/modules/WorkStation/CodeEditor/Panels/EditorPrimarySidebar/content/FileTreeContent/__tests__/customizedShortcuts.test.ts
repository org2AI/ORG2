// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";

import {
  CURRENT_SHORTCUT_PLATFORM,
  resetShortcutBindings,
  setShortcutBinding,
} from "@src/config/keyboard/shortcutBindings";
import { createSmokeRoot, dispatch } from "@src/test/reactSmokeHarness";
import { confirmDestructiveAction } from "@src/util/dialogs/confirmDestructiveAction";

import { useFileTreeMutationState } from "../useFileTreeMutationState";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@src/util/dialogs/confirmDestructiveAction", () => ({
  confirmDestructiveAction: vi.fn(async () => true),
}));
afterEach(() => {
  resetShortcutBindings();
  vi.clearAllMocks();
});

it("routes customized rename and delete through file actions and retains deletion confirmation", async () => {
  const run = vi.fn();
  function Tree() {
    const state = useFileTreeMutationState({
      selectedPath: "/project/a.ts",
      baseFlattenedNodes: [],
      onToggleDirectory: vi.fn(),
      dispatch: run,
      virtuosoRef: { current: null },
    });
    return createElement("div", {
      onKeyDown: state.handleKeyDown,
      "data-renaming": state.renamingPath ?? "",
    });
  }
  const root = createSmokeRoot();
  try {
    setShortcutBinding("file_menu_delete", CURRENT_SHORTCUT_PLATFORM, {
      key: "F7",
      ctrl: false,
      meta: false,
      alt: false,
      shift: false,
    });
    setShortcutBinding("file_menu_rename", CURRENT_SHORTCUT_PLATFORM, {
      key: "F6",
      ctrl: false,
      meta: false,
      alt: false,
      shift: false,
    });
    await root.render(createElement(Tree));
    const press = async (key: string) =>
      dispatch(() => {
        root.container.firstChild!.dispatchEvent(
          new KeyboardEvent("keydown", { key, bubbles: true })
        );
      });
    await press("F2");
    expect(
      root.container.firstElementChild?.getAttribute("data-renaming")
    ).toBe("");
    vi.mocked(confirmDestructiveAction).mockResolvedValueOnce(false);
    await press("F7");
    expect(run).not.toHaveBeenCalled();
    await press("F7");
    expect(run).toHaveBeenCalledWith(
      "file.delete",
      { path: "/project/a.ts" },
      "user"
    );
    await press("F6");
    expect(
      root.container.firstElementChild?.getAttribute("data-renaming")
    ).toBe("/project/a.ts");
  } finally {
    await root.unmount();
  }
});
