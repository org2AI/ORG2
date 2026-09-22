// @vitest-environment jsdom
/**
 * Mention offsets are plain-text coordinates end to end. They used to be read
 * with `Range.toString()`, which disagrees with the editor's plain text about
 * pills, `<br>` line breaks and zero-width anchors, so a mention typed after
 * any of those searched for the wrong query and, once picked, removed the
 * wrong span — an earlier pill included.
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

const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);

describe("ComposerInput mention offsets", () => {
  let composer: ComposerHarness;

  afterEach(async () => {
    await composer.unmount();
  });

  async function typeMention(query: string): Promise<void> {
    composer.typeText(`@${query.slice(0, -1)}`);
    await composer.settle();
    composer.typeText(query.slice(-1));
  }

  function pick(path: string): void {
    act(() => composer.ref.current!.insertFilePill(path));
  }

  it("searches for what was typed after a plain-text prefix", async () => {
    composer = await mountComposer("hello ");
    await typeMention("abc");
    expect(composer.lastMentionQuery()).toBe("abc");
    pick("/src/abacus.ts");
    expect(composer.ref.current!.getText()).toBe("hello abacus.ts ");
  });

  it("searches for what was typed after a pill whose label is truncated", async () => {
    composer = await mountComposer();
    // Rendered as "useEditorO....ts": six characters shorter than its name.
    pick("/src/useEditorOperations.ts");
    await typeMention("abc");
    expect(composer.lastMentionQuery()).toBe("abc");
  });

  it("keeps an earlier long-named pill when a mention is picked", async () => {
    composer = await mountComposer();
    pick("/src/useEditorOperations.ts");
    await typeMention("ab");
    pick("/src/abacus.ts");
    expect(composer.pillNames()).toEqual([
      "useEditorOperations.ts",
      "abacus.ts",
    ]);
    expect(composer.ref.current!.getText()).toBe(
      "useEditorOperations.ts abacus.ts "
    );
  });

  it("measures a <br> line break as one character", async () => {
    // Seeded, restored and pasted multi-line text all use <br>.
    composer = await mountComposer("line one\nline two ");
    expect(composer.host.querySelector("br")).not.toBeNull();
    await typeMention("abc");
    expect(composer.lastMentionQuery()).toBe("abc");
    pick("/src/abacus.ts");
    expect(composer.ref.current!.getText()).toBe(
      "line one\nline two abacus.ts "
    );
  });

  it("does not count a zero-width anchor in front of the caret", async () => {
    composer = await mountComposer("abc");
    composer.pressKey("Enter");
    const anchor = composer.host.lastChild as Text;
    expect(anchor.data).toBe(ZERO_WIDTH_SPACE);
    // A click on the empty last row can land the caret after the anchor.
    window.getSelection()!.collapse(anchor, 1);
    composer.typeText("x ");
    await typeMention("abc");
    expect(composer.lastMentionQuery()).toBe("abc");
    pick("/src/abacus.ts");
    expect(composer.ref.current!.getText()).toBe("abc\nx abacus.ts ");
  });

  it("keeps typing after a pill picked mid-line", async () => {
    composer = await mountComposer("hello world");
    window.getSelection()!.collapse(composer.host.firstChild as Text, 6);
    await typeMention("ab");
    pick("/src/abacus.ts");
    expect(composer.ref.current!.getText()).toBe("hello abacus.ts world");
    composer.typeText("X");
    expect(composer.ref.current!.getText()).toBe("hello abacus.ts Xworld");
  });

  it("keeps a pill inserted at the end of a line on that line", async () => {
    composer = await mountComposer("first");
    composer.pressKey("Enter");
    composer.typeText("second");
    // Back to the end of the first line: the boundary in front of the "\n".
    window.getSelection()!.collapse(composer.host, 1);
    pick("/src/a.ts");
    composer.typeText("X");
    expect(composer.ref.current!.getText()).toBe("firsta.ts X\nsecond");
  });
});
