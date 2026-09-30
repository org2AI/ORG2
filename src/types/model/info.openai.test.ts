import { getModelInfo } from "./info";

describe("OpenAI model info", () => {
  it("uses Astra capabilities instead of the generic GPT fallback", () => {
    for (const model of [
      "gpt-6-astra",
      "gpt-6-astra-ultra-fast",
      "openai/gpt-6-astra-high",
    ]) {
      expect(getModelInfo(model)).toMatchObject({
        providerKey: "openai",
        contextWindow: 1050,
        maxOutput: 128,
        vision: true,
        reasoning: true,
      });
    }
    expect(getModelInfo("gpt-4o")?.contextWindow).toBe(128);
  });

  it("recognizes GPT-6 Sol and Luna with their published context and output limits", () => {
    for (const model of [
      "gpt-6.1-sol",
      "gpt-6.1-sol-max-fast",
      "openai/gpt-6.1-sol-high",
      "gpt-6-sol",
      "gpt-6-luna",
      "openai/gpt-6-sol-high",
    ]) {
      expect(getModelInfo(model)).toMatchObject({
        providerKey: "openai",
        contextWindow: 1050,
        maxOutput: 128,
        vision: true,
        reasoning: true,
      });
    }
    expect(getModelInfo("gpt-6-terra")?.maxOutput).toBeUndefined();
  });

  it("uses per-model GPT-5 context limits before the family fallback", () => {
    for (const model of ["gpt-5.6", "gpt-5.6-sol", "gpt-5.4"]) {
      expect(getModelInfo(model)).toMatchObject({
        contextWindow: 1050,
        maxOutput: 128,
      });
    }
    for (const model of [
      "gpt-5.4-mini",
      "gpt-5.4-nano",
      "gpt-5.3-codex",
      "gpt-5.2",
    ]) {
      expect(getModelInfo(model)).toMatchObject({
        contextWindow: 400,
        maxOutput: 128,
      });
    }
  });
});
