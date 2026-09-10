import { describe, expect, it } from "vitest";

import type { SessionEvent } from "@src/engines/SessionCore";

import {
  isTerminalNativeSlashCommand,
  nativeSlashNames,
  parseNativeSlashCommand,
} from "../nativeSlashCommands";

function event(sessionId: string, commands: unknown): SessionEvent {
  return {
    sessionId,
    actionType: "native_command_catalog",
    args: { native_provider: "claude_code", slash_commands: commands },
  } as unknown as SessionEvent;
}
describe("native slash catalog", () => {
  it("uses only the current session's newest provider catalog", () => {
    expect(
      nativeSlashNames("claude_code", "a", [
        event("a", ["old"]),
        event("a", [
          "compact",
          "plugin:review",
          "compact",
          "__internal",
          null,
          "bad/name",
        ]),
        event("b", ["foreign"]),
      ])
    ).toEqual(["compact", "plugin:review"]);
    expect(nativeSlashNames("codex", "a", [event("a", ["context"])])).toEqual([
      "compact",
      "review",
      "init",
      "status",
    ]);
  });
  it("excludes commands the SDK declares terminal-only", () => {
    const init = event("a", ["compact", "doctor", "color", "plugin:review"]);
    init.args.terminal_slash_commands = ["doctor", "color"];
    expect(nativeSlashNames("claude_code", "a", [init])).toEqual([
      "compact",
      "plugin:review",
    ]);
  });
  it("rejects only terminal controls declared by the current provider and newest catalog", () => {
    const init = event("a", ["context", "doctor"]);
    init.args.terminal_slash_commands = ["doctor"];
    expect(
      isTerminalNativeSlashCommand("claude_code", "a", [init], "doctor")
    ).toBe(true);
    expect(
      isTerminalNativeSlashCommand("claude_code", "a", [init], "context")
    ).toBe(false);
    expect(isTerminalNativeSlashCommand("codex", "a", [init], "doctor")).toBe(
      false
    );
    expect(
      isTerminalNativeSlashCommand("claude_code", "b", [init], "doctor")
    ).toBe(false);
    expect(
      isTerminalNativeSlashCommand(
        "claude_code",
        "a",
        [init, event("a", ["doctor"])],
        "doctor"
      )
    ).toBe(false);
  });
  it("bounds provider-controlled names and count", () => {
    expect(
      nativeSlashNames("claude_code", "a", [
        event(
          "a",
          Array.from({ length: 600 }, (_, i) => `command${i}`)
        ),
      ])
    ).toHaveLength(512);
    expect(
      nativeSlashNames("claude_code", "a", [event("a", ["x".repeat(257)])])
    ).toEqual([]);
    expect(nativeSlashNames("cursor_cli", "a", [])).toEqual([]);
  });
  it("parses plugin tokens and preserves literal multiline arguments", () => {
    expect(parseNativeSlashCommand("/plugin:review auth\nfocus")).toEqual({
      name: "plugin:review",
      args: "auth\nfocus",
    });
    for (const text of ["explain /model", "/tmp/file", "//comment", "/"])
      expect(parseNativeSlashCommand(text)).toBeNull();
  });
});
