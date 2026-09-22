// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  blurActiveComposerOnBackgroundMouseDown,
  installBlurActiveComposerOnBackgroundMouseDown,
} from "../blurActiveComposer";

const disposers: Array<() => void> = [];

function mouseDown(target: EventTarget, overrides = {}) {
  blurActiveComposerOnBackgroundMouseDown({
    button: 0,
    defaultPrevented: false,
    target,
    ...overrides,
  });
}

function composerEditor(): HTMLDivElement {
  const editor = document.createElement("div");
  editor.className = "composer-input-content";
  editor.setAttribute("contenteditable", "true");
  editor.tabIndex = 0;
  return editor;
}

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
  window.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe("blurActiveComposerOnBackgroundMouseDown", () => {
  it("blurs an active session composer when the background is clicked", () => {
    const editor = composerEditor();
    const background = document.createElement("div");
    document.body.append(editor, background);
    editor.focus();
    editor.textContent = "draft";
    window.getSelection()!.collapse(editor.firstChild, 5);

    mouseDown(background);

    expect(document.activeElement).not.toBe(editor);
    expect(window.getSelection()!.rangeCount).toBe(0);
    expect(editor.textContent).toBe("draft");
  });

  it("preserves selection and focus inside composer shell padding", () => {
    const shell = document.createElement("div");
    shell.setAttribute("data-composer-focus-scope", "");
    const editor = composerEditor();
    shell.append(editor);
    document.body.append(shell);
    editor.focus();
    window.getSelection()!.collapse(editor, 0);

    mouseDown(shell);

    expect(document.activeElement).toBe(editor);
    expect(window.getSelection()!.anchorNode).toBe(editor);
  });

  it("preserves a selection made outside the composer", () => {
    const editor = composerEditor();
    const text = document.createElement("div");
    text.textContent = "transcript";
    document.body.append(editor, text);
    editor.focus();
    window.getSelection()!.selectAllChildren(text);
    // Isolate our selection ownership from jsdom's blur implementation,
    // which itself collapses the document selection.
    vi.spyOn(editor, "blur").mockImplementation(() => {});

    mouseDown(text);

    expect(window.getSelection()!.toString()).toBe("transcript");
  });

  it("clears a retained editor selection after native focus transfer without blurring the destination", async () => {
    const editor = composerEditor();
    const input = document.createElement("input");
    document.body.append(editor, input);
    editor.focus();
    window.getSelection()!.collapse(editor, 0);
    disposers.push(installBlurActiveComposerOnBackgroundMouseDown());

    input.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    input.focus();
    // Model WebKit retaining the old editable range after focus transfers.
    window.getSelection()!.collapse(editor, 0);
    await vi.runAllTimersAsync();

    expect(document.activeElement).toBe(input);
    expect(window.getSelection()!.rangeCount).toBe(0);
  });

  it("does not apply the composer policy to ordinary inputs", () => {
    const input = document.createElement("input");
    const background = document.createElement("div");
    document.body.append(input, background);
    input.focus();

    mouseDown(background);

    expect(document.activeElement).toBe(input);
  });

  it("keeps composer focus for prevented insertion-control mouse downs", () => {
    const editor = composerEditor();
    const control = document.createElement("button");
    document.body.append(editor, control);
    editor.focus();

    mouseDown(control, { defaultPrevented: true });

    expect(document.activeElement).toBe(editor);
  });

  it("keeps focus for secondary-button clicks", () => {
    const editor = composerEditor();
    const background = document.createElement("div");
    document.body.append(editor, background);
    editor.focus();

    mouseDown(background, { button: 2 });

    expect(document.activeElement).toBe(editor);
  });

  it("keeps focus when clicking inside the composer editor", () => {
    const editor = composerEditor();
    const child = document.createElement("span");
    editor.append(child);
    document.body.append(editor);
    editor.focus();

    mouseDown(child);

    expect(document.activeElement).toBe(editor);
  });

  it("captures background mouse downs before a descendant consumes them", async () => {
    const editor = composerEditor();
    const background = document.createElement("div");
    document.body.append(editor, background);
    editor.focus();
    disposers.push(installBlurActiveComposerOnBackgroundMouseDown());

    background.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, button: 0 })
    );
    await vi.runAllTimersAsync();

    expect(document.activeElement).not.toBe(editor);
  });

  it("observes preventDefault after capture before deciding to blur", async () => {
    const editor = composerEditor();
    const control = document.createElement("button");
    control.addEventListener("mousedown", (event) => event.preventDefault());
    document.body.append(editor, control);
    editor.focus();
    disposers.push(installBlurActiveComposerOnBackgroundMouseDown());

    control.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
        button: 0,
      })
    );
    await vi.runAllTimersAsync();

    expect(document.activeElement).toBe(editor);
  });

  it("cancels pending work and removes the listener on disposal", async () => {
    const editor = composerEditor();
    document.body.append(editor);
    editor.focus();
    await vi.runAllTimersAsync();
    const dispose = installBlurActiveComposerOnBackgroundMouseDown();
    disposers.push(dispose);
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(vi.getTimerCount()).toBe(1);

    dispose();
    expect(vi.getTimerCount()).toBe(0);
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await vi.runAllTimersAsync();

    expect(vi.getTimerCount()).toBe(0);
    expect(document.activeElement).toBe(editor);
  });
});
