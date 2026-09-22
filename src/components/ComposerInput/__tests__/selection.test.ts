// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  caretTextOffset,
  placeCaretAfter,
  placeCaretAfterPill,
  placeCaretAtEnd,
  placeCaretAtTextOffset,
} from "../selection";
import { extractPlainText } from "../utils";

describe("composer caret updates", () => {
  let host: HTMLDivElement;
  let pill: HTMLSpanElement;
  let trailing: Text;
  beforeEach(() => {
    host = document.createElement("div");
    host.setAttribute("contenteditable", "true");
    host.tabIndex = 0;
    pill = document.createElement("span");
    pill.setAttribute("contenteditable", "false");
    pill.textContent = "README.md";
    trailing = document.createTextNode(" ");
    host.append(document.createTextNode(""), pill, trailing);
    document.body.append(host);
    host.focus();
    window.getSelection()!.collapse(host, 0);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    host.remove();
    window.getSelection()?.removeAllRanges();
  });

  it("does not clear selection between the insertion caret and portal correction", () => {
    const selection = window.getSelection()!;
    const clear = vi.spyOn(selection, "removeAllRanges");
    const collapse = vi.spyOn(selection, "collapse");
    const focus = vi.spyOn(host, "focus");
    placeCaretAfter(trailing);
    // The portal layout effect and external focus requests target the same caret.
    placeCaretAfterPill(pill);
    placeCaretAtEnd(host);
    expect(clear).not.toHaveBeenCalled();
    // Every call targets the same caret, and every call re-collapses to it —
    // see the next test for why an "already there" shortcut is unsafe.
    expect(collapse).toHaveBeenCalledTimes(3);
    for (const call of collapse.mock.calls) {
      expect(call).toEqual([trailing, 1]);
    }
    expect(focus).not.toHaveBeenCalled();
    expect(selection.anchorNode).toBe(trailing);
    expect(selection.anchorOffset).toBe(1);
  });

  it("re-collapses even when the selection already reports the target", () => {
    // Regression: after a "\n" is inserted, WebKit reports the caret at the
    // target while painting it — and inserting typed text — at the end of the
    // previous line. Skipping the collapse as a no-op put text typed after
    // Enter on the line above.
    const selection = window.getSelection()!;
    selection.collapse(trailing, 1);
    const collapse = vi.spyOn(selection, "collapse");

    placeCaretAfter(trailing);

    expect(collapse).toHaveBeenCalledExactlyOnceWith(trailing, 1);
  });

  it("still collapses a non-empty selection whose anchor already matches the target", () => {
    const selection = window.getSelection()!;
    selection.setBaseAndExtent(trailing, 1, host, 0);
    expect(selection.isCollapsed).toBe(false);
    placeCaretAtEnd(host);
    expect(selection.isCollapsed).toBe(true);
    expect(selection.anchorNode).toBe(trailing);
    expect(selection.anchorOffset).toBe(1);
  });

  it("corrects an actual leading-edge caret and focuses an unfocused editor", () => {
    host.blur();
    placeCaretAfterPill(pill);
    expect(document.activeElement).toBe(host);
    expect(window.getSelection()!.anchorNode).toBe(trailing);
    expect(window.getSelection()!.anchorOffset).toBe(1);
  });
});

describe("caret after a pill", () => {
  let host: HTMLDivElement;
  let pill: HTMLSpanElement;
  beforeEach(() => {
    host = document.createElement("div");
    host.setAttribute("contenteditable", "true");
    host.tabIndex = 0;
    pill = document.createElement("span");
    pill.setAttribute("contenteditable", "false");
    document.body.append(host);
    host.focus();
  });
  afterEach(() => {
    host.remove();
    window.getSelection()?.removeAllRanges();
  });

  it("stays in front of the user's text instead of jumping to its end", () => {
    const rest = document.createTextNode("world");
    host.append(document.createTextNode("hello "), pill, rest);
    placeCaretAfterPill(pill);
    expect(window.getSelection()!.anchorNode).toBe(rest);
    expect(window.getSelection()!.anchorOffset).toBe(0);
  });

  it("stays on the pill's line when a line break follows", () => {
    const nextLine = document.createTextNode("\nsecond");
    host.append(document.createTextNode("first"), pill, nextLine);
    placeCaretAfterPill(pill);
    expect(window.getSelection()!.anchorNode).toBe(nextLine);
    expect(window.getSelection()!.anchorOffset).toBe(0);
  });

  it("looks past empty split-off nodes to the pill's separator", () => {
    const separator = document.createTextNode(" ");
    host.append(
      document.createTextNode(""),
      pill,
      document.createTextNode(""),
      separator,
      document.createTextNode("world")
    );
    placeCaretAfterPill(pill);
    expect(window.getSelection()!.anchorNode).toBe(separator);
    expect(window.getSelection()!.anchorOffset).toBe(1);
  });
});

describe("plain-text caret offsets", () => {
  const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);
  let host: HTMLDivElement;
  let tail: Text;
  beforeEach(() => {
    host = document.createElement("div");
    host.setAttribute("contenteditable", "true");
    host.tabIndex = 0;
    const pill = document.createElement("span");
    pill.setAttribute("data-composer-pill", "true");
    pill.setAttribute("data-file-name", "useEditorOperations.ts");
    pill.setAttribute("contenteditable", "false");
    // The rendered label is truncated; the name is what the text contains.
    pill.textContent = "useEditorO....ts";
    tail = document.createTextNode(`${ZERO_WIDTH_SPACE} see @ab`);
    host.append(
      document.createTextNode("one"),
      document.createElement("br"),
      pill,
      tail
    );
    document.body.append(host);
  });
  afterEach(() => {
    host.remove();
    window.getSelection()?.removeAllRanges();
  });

  it("indexes into the editor's plain text", () => {
    const range = document.createRange();
    range.setStart(tail, tail.data.length);
    range.collapse(true);
    const text = extractPlainText(host);
    expect(text).toBe("one\nuseEditorOperations.ts see @ab");
    expect(caretTextOffset(host, range)).toBe(text.length);

    range.setStart(tail, tail.data.indexOf("@"));
    expect(text[caretTextOffset(host, range)]).toBe("@");
  });

  it("places the caret at the offset it reports", () => {
    const text = extractPlainText(host);
    placeCaretAtTextOffset(host, text.indexOf("@"));
    const selection = window.getSelection()!;
    expect(selection.anchorNode).toBe(tail);
    expect(tail.data[selection.anchorOffset]).toBe("@");
    expect(caretTextOffset(host, selection.getRangeAt(0))).toBe(
      text.indexOf("@")
    );
  });

  it("places the caret on the line after a <br>", () => {
    host.replaceChildren(
      document.createTextNode("one"),
      document.createElement("br"),
      document.createTextNode("two")
    );
    placeCaretAtTextOffset(host, "one\n".length);
    expect(window.getSelection()!.anchorNode).toBe(host.lastChild);
    expect(window.getSelection()!.anchorOffset).toBe(0);
  });
});
