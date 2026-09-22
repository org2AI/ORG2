import { describe, expect, it } from "vitest";

import { resolveDefaultVariant } from "../defaultModelVariant";
import {
  MODEL_REASONING_LEVEL,
  resolveModelVariantFields,
} from "../modelVariants";
import { selectableModelVariants } from "../selectableModelVariants";
import { buildVariantEditOptions } from "../variantEditOptions";

describe("selectable model efforts", () => {
  it.each([
    "gpt-6-astra",
    "gpt-5.6-sol",
    "gpt-5.3-codex",
    "claude-opus-4-7",
    "glm-5.2",
    "grok-4.5",
    "o3",
    "o4-mini",
    "cursor-gpt-5.5",
    "cursor-claude-opus-4-7",
  ])("does not create a baseline rung for %s", (base) => {
    const ids = [base, `${base}-low`, `${base}-medium`, `${base}-high`];
    const variants = ids.map((model) => resolveModelVariantFields(model));
    expect(
      selectableModelVariants(variants).map((variant) => variant.model)
    ).toEqual(ids.slice(1));
    const options = buildVariantEditOptions(ids);
    expect(options.availableLevels).toEqual([
      MODEL_REASONING_LEVEL.LOW,
      MODEL_REASONING_LEVEL.MEDIUM,
      MODEL_REASONING_LEVEL.HIGH,
    ]);
    const expected = `${base}-${base.startsWith("claude-") ? "high" : "medium"}`;
    expect(options.resolveVariantId(options.parseSelection(base))).toBe(
      expected
    );
    expect(resolveDefaultVariant(base, variants, base)).toBe(expected);
    expect(resolveDefaultVariant(base, variants, `${base}-low`)).toBe(
      `${base}-low`
    );
  });

  it("preserves speed and thinking while resolving bare aliases", () => {
    const base = "claude-opus-4-8";
    const ids = [
      base,
      `${base}-high`,
      `${base}-thinking-fast`,
      `${base}-thinking-high-fast`,
    ];
    const options = buildVariantEditOptions(ids);
    expect(options.availableLevels).toEqual([MODEL_REASONING_LEVEL.HIGH]);
    expect(
      options.resolveVariantId(options.parseSelection(`${base}-thinking-fast`))
    ).toBe(`${base}-thinking-high-fast`);
    const variants = ids.map((model) => resolveModelVariantFields(model));
    expect(
      resolveDefaultVariant(
        base,
        selectableModelVariants(variants),
        `${base}-thinking-fast`
      )
    ).toBe(`${base}-thinking-high-fast`);
  });

  it("keeps standalone, speed-only and thinking-only model choices", () => {
    const ids = [
      "composer-2.5",
      "composer-2.5-fast",
      "claude-sonnet-4-6",
      "claude-sonnet-4-6-thinking",
      "custom-model",
    ];
    const variants = ids.map((model) => ({ model }));
    expect(selectableModelVariants(variants)).toEqual(variants);
    const options = buildVariantEditOptions(ids);
    for (const id of ids) {
      // Each real family is indexed separately by callers.
      const family = buildVariantEditOptions([id]);
      expect(family.availableLevels).toEqual([]);
      expect(family.resolveVariantId(family.parseSelection(id))).toBe(id);
    }
    expect(options.thinkingToggleable).toBe(true);
  });

  it("keeps speed toggles usable without inventing an effort level", () => {
    const options = buildVariantEditOptions([
      "composer-2.5",
      "composer-2.5-fast",
    ]);
    expect(options.availableLevels).toEqual([]);
    const selection = options.parseSelection("composer-2.5");
    expect(options.fastAvailable(selection)).toBe(true);
    expect(options.resolveVariantId({ ...selection, fast: true })).toBe(
      "composer-2.5-fast"
    );
  });
});
