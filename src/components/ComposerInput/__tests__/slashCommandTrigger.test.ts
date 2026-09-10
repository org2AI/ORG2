// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import {
  type KeyDownHandlerContext,
  canStartSlashCommand,
  createKeyDownHandler,
} from "../keyboard";

describe("canStartSlashCommand", () => {
  it("allows slash commands at the start of input", () => {
    expect(canStartSlashCommand("/skill", 0)).toBe(true);
  });

  it("allows slash commands after whitespace", () => {
    expect(canStartSlashCommand("run /skill", 4)).toBe(true);
    expect(canStartSlashCommand("run\n/skill", 4)).toBe(true);
  });

  it("ignores slash characters inside path-like text", () => {
    expect(canStartSlashCommand("github/x/y", 6)).toBe(false);
    expect(canStartSlashCommand("https://github.com/org2ai/ORG2", 6)).toBe(
      false
    );
  });
});

describe("dismissed command triggers", () => {
  it.each(["mention", "slash"])(
    "clears the %s query owner when its portal handles Escape",
    (kind) => {
      const host = document.createElement("div");
      host.textContent = "keep my draft";
      const mention = { active: kind === "mention", startOffset: 5 };
      const slash = { active: kind === "slash", startOffset: 5 };
      const ctx: KeyDownHandlerContext = {
        host: () => host,
        isComposing: () => false,
        getAtMention: () => mention,
        setAtMention: vi.fn(),
        getSlashCommand: () => slash,
        setSlashCommand: vi.fn(),
        getOnKeyDownForDropdown: () => () => kind === "mention",
        getOnKeyDownForSlashDropdown: () => () => kind === "slash",
        getOnAtMention: () => undefined,
        getOnAtMentionClose: () => undefined,
        getOnSlashCommand: () => undefined,
        getOnSlashCommandClose: () => undefined,
        getOnSubmit: () => undefined,
        getText: () => host.textContent || "",
        insertNewline: vi.fn(),
        undo: () => false,
        redo: () => false,
        requireCmdEnter: true,
        slashTriggerMode: "command",
      };
      const key = new KeyboardEvent("keydown", {
        key: "Escape",
        cancelable: true,
      });
      createKeyDownHandler(ctx)(key);
      expect(
        kind === "mention" ? ctx.setAtMention : ctx.setSlashCommand
      ).toHaveBeenCalledWith({ active: false, startOffset: 0 });
      expect(key.defaultPrevented).toBe(true);
      expect(host.textContent).toBe("keep my draft");
    }
  );
});
