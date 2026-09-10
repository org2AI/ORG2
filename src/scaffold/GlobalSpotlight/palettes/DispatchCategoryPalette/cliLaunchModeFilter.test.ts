import { describe, expect, it } from "vitest";

import { CLI_LAUNCH_MODE } from "@src/store/session/creatorStateAtom";

import { isCliAgentHiddenByLaunchMode } from "./cliLaunchModeFilter";

describe("isCliAgentHiddenByLaunchMode", () => {
  it("never filters when the surface has no launch-mode switch", () => {
    expect(
      isCliAgentHiddenByLaunchMode({
        cliLaunchMode: undefined,
        agentType: "kiro",
        supportsGui: false,
      })
    ).toBe(false);
  });

  it("keeps every installed runtime in the TUI list", () => {
    expect(
      isCliAgentHiddenByLaunchMode({
        cliLaunchMode: CLI_LAUNCH_MODE.TUI,
        agentType: "kiro",
        supportsGui: false,
      })
    ).toBe(false);
  });

  it("hides runtimes without GUI support from the GUI list", () => {
    expect(
      isCliAgentHiddenByLaunchMode({
        cliLaunchMode: CLI_LAUNCH_MODE.GUI,
        agentType: "kiro",
        supportsGui: false,
      })
    ).toBe(true);
    expect(
      isCliAgentHiddenByLaunchMode({
        cliLaunchMode: CLI_LAUNCH_MODE.GUI,
        agentType: "claude_code",
        supportsGui: true,
      })
    ).toBe(false);
  });

  it("keeps allowlisted continuation targets visible in the GUI list", () => {
    const nativeTargets = ["claude_code", "codex"] as const;

    expect(
      isCliAgentHiddenByLaunchMode({
        cliLaunchMode: CLI_LAUNCH_MODE.GUI,
        agentType: "claude_code",
        supportsGui: false,
        allowedCliAgentTypes: nativeTargets,
      })
    ).toBe(false);
    expect(
      isCliAgentHiddenByLaunchMode({
        cliLaunchMode: CLI_LAUNCH_MODE.GUI,
        agentType: "kiro",
        supportsGui: false,
        allowedCliAgentTypes: nativeTargets,
      })
    ).toBe(true);
  });
});
