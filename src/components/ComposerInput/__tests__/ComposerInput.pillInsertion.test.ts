// @vitest-environment jsdom
import { act, createElement, createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type SmokeRoot, createSmokeRoot } from "@src/test/reactSmokeHarness";

import ComposerInput, { type ComposerInputRef } from "../index";

vi.mock("@src/util/ui/theme/themeUtils", () => ({
  useCurrentTheme: () => ({ isDark: false }),
}));
vi.mock("@src/store/skills/installedSkillsAtom", async () => {
  const { atom } = await import("jotai");
  return { installedSkillsAtom: atom([]) };
});

describe("ComposerInput pill focus", () => {
  let root: SmokeRoot;
  beforeEach(() => {
    root = createSmokeRoot();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await root.unmount();
    window.getSelection()?.removeAllRanges();
  });

  it("retains a text caret when focusing an editor containing only a pill", async () => {
    const ref = createRef<ComposerInputRef>();
    await root.render(createElement(ComposerInput, { ref }));
    const clearSelection = vi.spyOn(window.getSelection()!, "removeAllRanges");
    act(() => {
      ref.current!.insertFilePill("README.md");
      const pill = root.container.querySelector("[data-composer-pill]")!;
      ref.current!.focus();
      expect(window.getSelection()!.anchorNode).toBe(pill.nextSibling);
      expect(window.getSelection()!.anchorOffset).toBe(1);
    });
    expect(clearSelection).not.toHaveBeenCalled();
  });
});
