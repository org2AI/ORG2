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

function writableClipboard(): DataTransfer {
  const data = new Map<string, string>();
  return {
    setData: (type: string, value: string) => data.set(type, value),
    getData: (type: string) => data.get(type) ?? "",
  } as unknown as DataTransfer;
}

describe("ComposerInput cut", () => {
  let root: SmokeRoot;
  let ref: ReturnType<typeof createRef<ComposerInputRef>>;
  let host: HTMLDivElement;
  const onChange = vi.fn();

  beforeEach(() => {
    root = createSmokeRoot();
    ref = createRef<ComposerInputRef>();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await root.unmount();
    window.getSelection()?.removeAllRanges();
  });

  async function mount(text: string): Promise<void> {
    await root.render(
      createElement(ComposerInput, {
        ref,
        initialContent: text,
        requireCmdEnter: true,
        onContentChange: onChange,
        onSubmit: vi.fn(),
      })
    );
    host = root.container.querySelector('[contenteditable="true"]')!;
    onChange.mockClear();
  }

  function selectText(start: number, end: number): void {
    const textNode = host.firstChild as Text;
    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, end);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function cut(): { event: Event; clipboard: DataTransfer } {
    const clipboard = writableClipboard();
    const event = new Event("cut", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: clipboard });
    act(() => host.dispatchEvent(event));
    return { event, clipboard };
  }

  function pressKey(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ...init,
    });
    act(() => host.dispatchEvent(event));
    return event;
  }

  it("leaves a caret where the cut text was", async () => {
    await mount("hello brave world");
    selectText(6, 12);

    const { event, clipboard } = cut();
    expect(event.defaultPrevented).toBe(true);
    expect(clipboard.getData("text/plain")).toBe("brave ");
    expect(ref.current?.getText()).toBe("hello world");

    // An editor with no selection range paints no caret and drops typing.
    const selection = window.getSelection()!;
    expect(selection.rangeCount).toBe(1);
    expect(selection.isCollapsed).toBe(true);
    expect(host.contains(selection.anchorNode)).toBe(true);
    expect(selection.anchorNode).toBe(host.firstChild);
    expect(selection.anchorOffset).toBe(6);
  });

  it("keeps the caret in the editor when the cut empties it", async () => {
    await mount("everything");
    selectText(0, 10);

    cut();
    expect(ref.current?.getText()).toBe("");
    expect(onChange).toHaveBeenLastCalledWith("");
    // Settled like any other full deletion: no leftover empty text nodes.
    expect(host.childNodes.length).toBe(0);

    const selection = window.getSelection()!;
    expect(selection.rangeCount).toBe(1);
    expect(selection.isCollapsed).toBe(true);
    expect(
      selection.anchorNode === host || host.contains(selection.anchorNode)
    ).toBe(true);
  });

  it("Cmd+Z restores the cut text", async () => {
    await mount("hello brave world");
    selectText(6, 12);
    cut();
    expect(ref.current?.getText()).toBe("hello world");

    const undo = pressKey("z", { metaKey: true });
    expect(undo.defaultPrevented).toBe(true);
    expect(ref.current?.getText()).toBe("hello brave world");
    expect(onChange).toHaveBeenLastCalledWith("hello brave world");
    // Back where the cut was made, not thrown to the end of the text.
    expect(window.getSelection()!.anchorNode).toBe(host.firstChild);
    expect(window.getSelection()!.anchorOffset).toBe(6);
  });
});
