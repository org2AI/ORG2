// @vitest-environment jsdom
/**
 * Undo coverage for edits the composer performs itself on keydown, and for
 * where the caret lands once a step is undone or redone.
 */
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type ComposerHarness, mountComposer } from "./composerTestHarness";

vi.mock("@src/util/ui/theme/themeUtils", () => ({
  useCurrentTheme: () => ({ isDark: false }),
}));
vi.mock("@src/store/skills/installedSkillsAtom", async () => {
  const { atom } = await import("jotai");
  return { installedSkillsAtom: atom([]) };
});

describe("ComposerInput history", () => {
  let composer: ComposerHarness;

  afterEach(async () => {
    await composer.unmount();
  });

  function caret(): { node: Node | null; offset: number } {
    const selection = window.getSelection()!;
    return { node: selection.anchorNode, offset: selection.anchorOffset };
  }

  it.each(["Backspace", "Delete"])(
    "Cmd+Z brings back a pill removed with %s",
    async (key) => {
      composer = await mountComposer("see ");
      act(() => composer.ref.current!.insertFilePill("/src/README.md"));
      expect(composer.pillNames()).toEqual(["README.md"]);
      const pill = composer.host.querySelector("[data-composer-pill]")!;
      const pillIndex = Array.from(composer.host.childNodes).indexOf(pill);
      // Put the caret against the pill: behind it for Backspace, in front of
      // it for forward Delete.
      window
        .getSelection()!
        .collapse(
          composer.host,
          key === "Backspace" ? pillIndex + 1 : pillIndex
        );

      expect(composer.pressKey(key).defaultPrevented).toBe(true);
      expect(composer.pillNames()).toEqual([]);

      composer.pressKey("z", { metaKey: true });
      expect(composer.pillNames()).toEqual(["README.md"]);
      expect(composer.ref.current!.getText()).toBe("see README.md ");
    }
  );

  it("Cmd+Z brings back a deleted selection that spanned a pill", async () => {
    composer = await mountComposer("see ");
    act(() => composer.ref.current!.insertFilePill("/src/README.md"));
    composer.typeText("now");
    const range = document.createRange();
    range.selectNodeContents(composer.host);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    composer.pressKey("Backspace");
    expect(composer.ref.current!.getText()).toBe("");

    composer.pressKey("z", { metaKey: true });
    expect(composer.pillNames()).toEqual(["README.md"]);
    expect(composer.ref.current!.getText()).toBe("see README.md now");
  });

  it("undo and redo return the caret to where the edit happened", async () => {
    composer = await mountComposer("hello world");
    const text = composer.host.firstChild as Text;
    window.getSelection()!.collapse(text, 5);
    composer.typeText(",");
    expect(composer.ref.current!.getText()).toBe("hello, world");

    composer.pressKey("z", { metaKey: true });
    expect(composer.ref.current!.getText()).toBe("hello world");
    // Not the end of the text, which is where every undo used to leave it.
    expect(caret()).toEqual({ node: composer.host.firstChild, offset: 5 });

    composer.pressKey("z", { metaKey: true, shiftKey: true });
    expect(composer.ref.current!.getText()).toBe("hello, world");
    expect(caret()).toEqual({ node: composer.host.firstChild, offset: 6 });
  });

  it("restores the caret after a pill by the pill's full name", async () => {
    composer = await mountComposer();
    // Long enough that the rendered label is shorter than the name.
    act(() =>
      composer.ref.current!.insertFilePill("/src/useEditorOperations.ts")
    );
    composer.typeText("ab");
    composer.typeText("c");

    composer.pressKey("z", { metaKey: true });
    expect(composer.ref.current!.getText()).toBe("useEditorOperations.ts ab");
    composer.typeText("X");
    expect(composer.ref.current!.getText()).toBe("useEditorOperations.ts abX");
  });

  it("leaves Cmd+Shift+A and Cmd+Alt+A to other shortcuts", async () => {
    composer = await mountComposer("hello");
    expect(composer.pressKey("a", { metaKey: true }).defaultPrevented).toBe(
      true
    );
    expect(
      composer.pressKey("a", { metaKey: true, shiftKey: true }).defaultPrevented
    ).toBe(false);
    expect(
      composer.pressKey("a", { metaKey: true, altKey: true }).defaultPrevented
    ).toBe(false);
  });
});
