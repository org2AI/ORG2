import { getModelInfo } from "./info";

describe("Anthropic model info", () => {
  it("uses Fable 5.1 output limits before the generic Fable fallback", () => {
    for (const model of [
      "claude-fable-5-1",
      "claude-fable-5-1-max",
      "anthropic/claude-fable-5-1-xhigh",
    ]) {
      expect(getModelInfo(model)).toMatchObject({
        providerKey: "anthropic",
        contextWindow: 1000,
        maxOutput: 128,
        vision: true,
        reasoning: true,
      });
    }
    expect(getModelInfo("claude-fable-5")?.maxOutput).toBe(128);
    expect(getModelInfo("claude-mythos-5")?.maxOutput).toBe(128);
  });

  it("recognizes Opus 5.5 before the generic Claude fallback", () => {
    expect(getModelInfo("claude-opus-5-5")).toMatchObject({
      providerKey: "anthropic",
      contextWindow: 1000,
      maxOutput: 128,
      vision: true,
      reasoning: true,
    });
  });

  it("recognizes Sonnet 5.5 and its effort variants", () => {
    for (const model of [
      "claude-sonnet-5-5",
      "claude-sonnet-5-5-thinking-high",
      "anthropic/claude-sonnet-5-5-max",
    ]) {
      expect(getModelInfo(model)).toMatchObject({
        providerKey: "anthropic",
        contextWindow: 1000,
        maxOutput: 128,
        vision: true,
        reasoning: true,
        pricingTier: "moderate",
      });
    }
  });

  it("uses published limits for current and legacy Claude models", () => {
    for (const model of [
      "claude-opus-5",
      "claude-sonnet-5",
      "claude-opus-4-6",
      "claude-opus-4-7",
      "claude-opus-4-8",
      "claude-sonnet-4-6",
    ]) {
      expect(getModelInfo(model)).toMatchObject({
        contextWindow: 1000,
        maxOutput: 128,
      });
    }
    for (const model of [
      "claude-opus-4-5",
      "claude-opus-4.5",
      "claude-sonnet-4-5",
    ]) {
      expect(getModelInfo(model)).toMatchObject({
        contextWindow: 200,
        maxOutput: 64,
      });
    }
  });
});
