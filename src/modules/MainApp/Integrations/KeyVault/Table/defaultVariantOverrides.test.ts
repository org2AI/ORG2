import { describe, expect, it } from "vitest";

import {
  applyDefaultVariantOverrides,
  defaultVariantOverridesSettled,
} from "./defaultVariantOverrides";

const STORED = [
  { base_model: "gpt-6-astra", model: "gpt-6-astra-low" },
  { base_model: "claude-opus-4-7", model: "claude-opus-4-7-high" },
];

describe("applyDefaultVariantOverrides", () => {
  it("replaces a stored pick in place and appends unseen families", () => {
    const merged = applyDefaultVariantOverrides(
      STORED,
      new Map([
        ["gpt-6-astra", "gpt-6-astra-max-fast"],
        ["gemini-3-pro", "gemini-3-pro-high"],
      ])
    );

    expect(merged).toEqual([
      { base_model: "gpt-6-astra", model: "gpt-6-astra-max-fast" },
      { base_model: "claude-opus-4-7", model: "claude-opus-4-7-high" },
      { base_model: "gemini-3-pro", model: "gemini-3-pro-high" },
    ]);
  });

  it("returns the stored list untouched without overrides", () => {
    expect(applyDefaultVariantOverrides(STORED, new Map())).toEqual(STORED);
    expect(applyDefaultVariantOverrides(undefined, new Map())).toEqual([]);
  });
});

describe("defaultVariantOverridesSettled", () => {
  it("is settled only once every override matches what was stored", () => {
    const pending = new Map([["gpt-6-astra", "gpt-6-astra-max"]]);
    expect(defaultVariantOverridesSettled(STORED, pending)).toBe(false);
    expect(
      defaultVariantOverridesSettled(
        [{ base_model: "gpt-6-astra", model: "gpt-6-astra-max" }],
        pending
      )
    ).toBe(true);
  });
});
