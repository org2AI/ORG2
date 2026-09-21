/**
 * Shared jsdom driver for ComposerInput component tests: mounts the real
 * component and types into it the way a browser would, so a test exercises
 * the keydown → beforeinput → input pipeline rather than a single handler.
 */
import { act, createElement, createRef } from "react";
import { vi } from "vitest";

import { type SmokeRoot, createSmokeRoot } from "@src/test/reactSmokeHarness";

import ComposerInput, { type ComposerInputRef } from "../index";
import { placeCaretAtEnd } from "../selection";
import type { ComposerInputProps } from "../types";

export interface ComposerHarness {
  ref: React.RefObject<ComposerInputRef | null>;
  host: HTMLDivElement;
  onChange: ReturnType<typeof vi.fn>;
  onAtMention: ReturnType<typeof vi.fn>;
  /** Query the mention dropdown was last asked to search for. */
  lastMentionQuery: () => string | undefined;
  typeText: (text: string) => void;
  pressKey: (key: string, init?: KeyboardEventInit) => KeyboardEvent;
  /** Let the keydown fallback timers for "@" and "/" run. */
  settle: () => Promise<void>;
  pillNames: () => Array<string | null>;
  unmount: () => Promise<void>;
}

/** jsdom has no layout, so Range geometry does not exist until stubbed. */
function stubRangeGeometry(): void {
  const rect = { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 };
  Range.prototype.getBoundingClientRect = () => rect as DOMRect;
  Range.prototype.getClientRects = () =>
    [rect] as unknown as ReturnType<Range["getClientRects"]>;
}

export async function mountComposer(
  initialContent = "",
  props: Partial<ComposerInputProps> = {}
): Promise<ComposerHarness> {
  stubRangeGeometry();
  const root: SmokeRoot = createSmokeRoot();
  const ref = createRef<ComposerInputRef>();
  const onChange = vi.fn();
  const onAtMention = vi.fn();
  await root.render(
    createElement(ComposerInput, {
      ref,
      initialContent,
      requireCmdEnter: true,
      onContentChange: onChange,
      onAtMention,
      onSubmit: vi.fn(),
      ...props,
    })
  );
  const host = root.container.querySelector<HTMLDivElement>(
    '[contenteditable="true"]'
  )!;
  placeCaretAtEnd(host);
  onChange.mockClear();

  const pressKey = (key: string, init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ...init,
    });
    act(() => host.dispatchEvent(event));
    return event;
  };

  /** Insert one character where the caret is, the way the browser would. */
  const typeChar = (char: string) => {
    if (pressKey(char).defaultPrevented) return;
    const before = new Event("beforeinput", {
      bubbles: true,
      cancelable: true,
    }) as InputEvent;
    Object.defineProperty(before, "inputType", { value: "insertText" });
    Object.defineProperty(before, "data", { value: char });
    act(() => host.dispatchEvent(before));
    if (before.defaultPrevented) return;

    const selection = window.getSelection()!;
    const range = selection.getRangeAt(0);
    if (range.startContainer.nodeType === Node.TEXT_NODE) {
      const node = range.startContainer as Text;
      const offset = range.startOffset;
      node.insertData(offset, char);
      selection.collapse(node, offset + 1);
    } else {
      const node = document.createTextNode(char);
      range.insertNode(node);
      selection.collapse(node, 1);
    }
    const input = new Event("input", { bubbles: true }) as InputEvent;
    Object.defineProperty(input, "inputType", { value: "insertText" });
    act(() => host.dispatchEvent(input));
  };

  return {
    ref,
    host,
    onChange,
    onAtMention,
    lastMentionQuery: () => onAtMention.mock.calls.at(-1)?.[0],
    typeText: (text) => {
      for (const char of text) typeChar(char);
    },
    pressKey,
    settle: () =>
      act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }),
    pillNames: () =>
      Array.from(host.querySelectorAll("[data-composer-pill]")).map((pill) =>
        pill.getAttribute("data-file-name")
      ),
    unmount: async () => {
      await root.unmount();
      window.getSelection()?.removeAllRanges();
    },
  };
}
