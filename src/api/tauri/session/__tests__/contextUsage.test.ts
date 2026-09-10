import { describe, expect, it, vi } from "vitest";

import { claudeCodeContextUsage } from "@src/api/tauri/externalHistory/sources/claudeCode";

import {
  cliSessionContextUsage,
  readSourceContextUsage,
} from "../contextUsage";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

describe("source context routing", () => {
  it("routes Claude and managed CLI reads without sharing another source's result", async () => {
    invoke.mockResolvedValue(null);
    await Promise.all([
      claudeCodeContextUsage("same"),
      cliSessionContextUsage("same"),
    ]);
    expect(invoke).toHaveBeenCalledWith("claude_code_context_usage", {
      sessionId: "same",
    });
    expect(invoke).toHaveBeenCalledWith("cli_agent_context_usage", {
      sessionId: "same",
    });
    expect(invoke).toHaveBeenCalledTimes(2);
  });
  it("shares overlapping Claude requests", async () => {
    let resolve!: (value: null) => void;
    invoke.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      })
    );
    const first = claudeCodeContextUsage("claudecodeapp-one");
    expect(
      readSourceContextUsage("claude_code_context_usage", "claudecodeapp-one")
    ).toBe(first);
    resolve(null);
    await first;
  });
});
