import { describe, expect, it } from "vitest";

import { getAgentSourceProvider } from "./AgentSourceIcon";

describe("getAgentSourceProvider", () => {
  it.each([
    ["/Users/me/.codex/skills/hatch-pet/SKILL.md", "codex"],
    ["/Users/me/.claude/skills/review/SKILL.md", "claude"],
    ["/repo/.cursor/skills-cursor/new-repo/SKILL.md", "cursor"],
    ["C:\\Users\\me\\.opencode\\skills\\shell\\SKILL.md", "opencode"],
  ])("resolves %s to %s", (path, provider) => {
    expect(getAgentSourceProvider(path)).toBe(provider);
  });

  it("does not classify generic or ORGII paths as an agent source", () => {
    expect(
      getAgentSourceProvider("/Users/me/.orgii/skills/hatch-pet/SKILL.md")
    ).toBe(null);
    expect(getAgentSourceProvider("/repo/skills/review/SKILL.md")).toBe(null);
  });
});
