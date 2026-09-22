// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  type InputHandlerContext,
  createInputHandler,
} from "../composerInput.inputHandler";

function setup() {
  const host = document.createElement("div");
  host.contentEditable = "true";
  document.body.replaceChildren(host);
  const inactive = { active: false, startOffset: 0 };
  const onContentChange = vi.fn();
  const ctx: InputHandlerContext = {
    host: () => host,
    reconcilePillsFromDom: vi.fn(),
    commitHistoryBoundary: vi.fn(),
    clearHost: vi.fn(() => {
      host.textContent = "";
    }),
    updateEmptyState: vi.fn(),
    getOnContentChange: () => onContentChange,
    getAtMention: () => inactive,
    setAtMention: vi.fn(),
    markAtMentionOpened: vi.fn(),
    getAtMentionOpenedAt: () => 0,
    getOnAtMention: () => undefined,
    getOnAtMentionClose: () => undefined,
    getSlashCommand: () => inactive,
    setSlashCommand: vi.fn(),
    markSlashCommandOpened: vi.fn(),
    getSlashCommandOpenedAt: () => 0,
    getOnSlashCommand: () => undefined,
    getOnSlashCommandClose: () => undefined,
  };
  return { host, ctx, onContentChange, handle: createInputHandler(ctx) };
}

const input = (inputType: string, isComposing = false) =>
  new InputEvent("input", { inputType, isComposing });

describe("ComposerInput input handler — IME composition", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("does not treat an IME's marked-text swap as the user emptying the editor", () => {
    // Regression: each IME keystroke replaces the marked text with a
    // delete/insert pair. Clearing the host on the delete half detached the
    // IME's text node and sent the caret to the start and back.
    const { host, ctx, handle } = setup();
    const marked = document.createTextNode("");
    host.appendChild(marked);

    for (const type of ["deleteCompositionText", "deleteByComposition"]) {
      handle(input(type, true));
    }

    expect(ctx.clearHost).not.toHaveBeenCalled();
    expect(ctx.updateEmptyState).not.toHaveBeenCalled();
    expect(marked.isConnected).toBe(true);
  });

  it("still updates state for the insertion half of a composition step", () => {
    const { host, ctx, onContentChange, handle } = setup();
    host.textContent = "ni";

    handle(input("insertCompositionText", true));

    expect(ctx.updateEmptyState).toHaveBeenCalled();
    expect(onContentChange).toHaveBeenCalledWith("ni");
  });

  it("settles an editor emptied by a cancelled composition when it ends", () => {
    const { host, ctx, onContentChange, handle } = setup();
    host.appendChild(document.createTextNode(""));

    handle(new CompositionEvent("compositionend"));

    expect(ctx.clearHost).toHaveBeenCalledTimes(1);
    expect(onContentChange).toHaveBeenCalledWith("");
  });

  it("does not clear a composition that ended with text", () => {
    const { host, ctx, onContentChange, handle } = setup();
    host.textContent = "你";

    handle(new CompositionEvent("compositionend"));

    expect(ctx.clearHost).not.toHaveBeenCalled();
    expect(onContentChange).toHaveBeenCalledWith("你");
  });

  it("still clears the editor when the user deletes the last character", () => {
    const { ctx, onContentChange, handle } = setup();

    handle(input("deleteContentBackward"));

    expect(ctx.clearHost).toHaveBeenCalledTimes(1);
    expect(onContentChange).toHaveBeenCalledWith("");
  });
});
