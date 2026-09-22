import { describe, expect, it } from "vitest";

import {
  getIconProviderFromModelName,
  isGenericTierModelName,
} from "./modelNameIcons";

// "auto" / "default" / "premium" are Cursor's routing tiers, but every other
// agent uses the same words generically — a claude_code key's "default" means
// "whatever the CLI picks". Resolving them to Cursor everywhere painted the
// Cursor cube on unrelated agents' rows in the model pickers.
describe("routing-tier model names", () => {
  const TIERS = ["auto", "default", "premium", "Default", "AUTO"];

  it("claims them for Cursor when the agent behind them is Cursor", () => {
    for (const tier of TIERS) {
      expect(getIconProviderFromModelName(tier, "cursor_cli")).toBe("cursor");
      expect(getIconProviderFromModelName(tier, "cursor")).toBe("cursor");
    }
  });

  it("does not claim them for any other agent", () => {
    for (const tier of TIERS) {
      expect(getIconProviderFromModelName(tier, "claude_code")).toBe("unknown");
      expect(getIconProviderFromModelName(tier, "codex")).toBe("unknown");
      expect(getIconProviderFromModelName(tier, "gemini_api")).toBe("unknown");
    }
  });

  it("does not guess a brand without an agent hint", () => {
    for (const tier of TIERS) {
      expect(getIconProviderFromModelName(tier)).toBe("unknown");
    }
  });

  it("marks them as carrying no brand so callers can skip the agent mark", () => {
    for (const tier of TIERS) {
      expect(isGenericTierModelName(tier)).toBe(true);
    }
    for (const modelName of [
      "composer-1",
      "claude-opus-4",
      "gpt-5",
      "auto-1",
    ]) {
      expect(isGenericTierModelName(modelName)).toBe(false);
    }
  });
});

describe("brand inference from model names", () => {
  it.each([
    ["composer-1", "cursor"],
    ["gpt-5", "openai"],
    ["openai/gpt-4o", "openai"],
    ["o5-high", "openai"],
    ["claude-opus-4-5", "claude"],
    ["op-sonnet-relay", "claude"],
    ["gemini-3-pro", "gemini"],
    ["copilot-premium", "copilot"],
    ["longcat-2", "longcat"],
    ["muse-spark-1.3", "meta_ai"],
    ["muse-spark-1.3-max", "meta_ai"],
    ["cursor/muse-spark-1-3", "meta_ai"],
    ["meta/muse-spark", "meta_ai"],
    ["Muse Spark 1.3", "meta_ai"],
    ["llama-4-maverick", "meta"],
    ["museum-7b", "unknown"],
    ["some-unlisted-model", "unknown"],
  ])("%s → %s", (modelName, provider) => {
    expect(getIconProviderFromModelName(modelName)).toBe(provider);
  });

  it("keeps preferring the model name over the agent hint", () => {
    expect(getIconProviderFromModelName("gpt-5", "cursor_cli")).toBe("openai");
    expect(getIconProviderFromModelName("claude-opus-4-5", "cursor_cli")).toBe(
      "claude"
    );
  });
});
