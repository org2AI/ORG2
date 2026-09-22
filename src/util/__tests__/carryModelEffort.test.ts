import { describe, expect, it } from "vitest";

import { carryModelEffort } from "../carryModelEffort";

const GPT_55 = [
  "gpt-5.5",
  "gpt-5.5-low",
  "gpt-5.5-high",
  "gpt-5.5-high-fast",
  "gpt-5.5-xhigh",
];

describe("carryModelEffort", () => {
  it("keeps the current level when switching model families", () => {
    expect(carryModelEffort("gpt-5.4-mini-high", "gpt-5.5-low", GPT_55)).toBe(
      "gpt-5.5-high"
    );
  });

  it("prefers the variant that also keeps fast", () => {
    expect(carryModelEffort("gpt-5.4-mini-high-fast", "gpt-5.5", GPT_55)).toBe(
      "gpt-5.5-high-fast"
    );
  });

  it("falls back to the level alone when fast is unavailable", () => {
    expect(carryModelEffort("gpt-5.4-mini-xhigh-fast", "gpt-5.5", GPT_55)).toBe(
      "gpt-5.5-xhigh"
    );
  });

  it("returns the picked model when the level is not offered", () => {
    expect(carryModelEffort("gpt-5.4-nano-none", "gpt-5.5-low", GPT_55)).toBe(
      "gpt-5.5-low"
    );
  });

  it("returns the picked model when the current model has no effort", () => {
    expect(carryModelEffort("gpt-5.4-nano", "gpt-5.5-low", GPT_55)).toBe(
      "gpt-5.5-low"
    );
    expect(carryModelEffort(undefined, "gpt-5.5-low", GPT_55)).toBe(
      "gpt-5.5-low"
    );
  });

  it("ignores candidates from other base models", () => {
    expect(
      carryModelEffort("gpt-5.5-high", "gpt-5.4-mini-low", [
        ...GPT_55,
        "gpt-5.4-mini-low",
      ])
    ).toBe("gpt-5.4-mini-low");
  });
});
