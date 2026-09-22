import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  MODEL_REASONING_LEVEL,
  type ModelReasoningLevel,
  resolveModelVariantFields,
} from "@src/util/modelVariants";

import ModelVariantInlineCard from "./ModelVariantInlineCard";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const slider = vi.hoisted(() => ({
  value: undefined as ModelReasoningLevel | undefined,
  fast: false,
  onChange: vi.fn<(level: ModelReasoningLevel) => void>(),
}));
vi.mock("@src/components/ModelPropertiesDropdown/EffortSlider", () => ({
  EffortSlider: (props: typeof slider) => {
    Object.assign(slider, props);
    return null;
  },
}));

describe("ModelVariantInlineCard default persistence", () => {
  it.each([
    ["o4-mini", "o4"],
    ["claude-opus-4-7", "claude-opus-4-7"],
  ])(
    "preserves the %s family key after filtering bare choices",
    (base, key) => {
      const onChange = vi.fn();
      renderToStaticMarkup(
        React.createElement(ModelVariantInlineCard, {
          variants: [base, `${base}-low`, `${base}-medium`, `${base}-high`].map(
            (model) => resolveModelVariantFields(model)
          ),
          embedded: true,
          defaultVariantByBaseModel: new Map([[key, `${base}-high`]]),
          onChangeDefaultVariant: onChange,
        })
      );

      // The collapsed row shows the persisted level on the effort slider;
      // dragging it saves the matching variant under the family key.
      expect(slider.value).toBe(MODEL_REASONING_LEVEL.HIGH);
      slider.onChange(MODEL_REASONING_LEVEL.LOW);
      expect(onChange).toHaveBeenCalledWith(key, `${base}-low`);
    }
  );
});

describe("ModelVariantInlineCard row controls", () => {
  const GPT_6_FAMILY = [
    "gpt-6-astra-low",
    "gpt-6-astra-low-fast",
    "gpt-6-astra-medium",
    "gpt-6-astra-medium-fast",
    "gpt-6-astra-high",
    "gpt-6-astra-high-fast",
  ];

  it("keeps the effort x speed grid inside the options dropdown", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ModelVariantInlineCard, {
        variants: GPT_6_FAMILY.map((model) => resolveModelVariantFields(model)),
        embedded: true,
        defaultVariantByBaseModel: new Map([
          ["gpt-6-astra", "gpt-6-astra-low"],
        ]),
        onChangeDefaultVariant: vi.fn(),
      })
    );

    // The row shows the slider (mocked away), one Fast toggle and the options
    // trigger — every per-effort row stays inside the closed dropdown.
    expect(markup).not.toContain(">Standard<");
    expect(markup).not.toContain(">Medium<");
    expect(markup).toContain("modelsTable.showVersionDetails");
    expect(slider.value).toBe(MODEL_REASONING_LEVEL.LOW);
    expect(slider.fast).toBe(false);
  });

  it("keeps the saved speed while the slider changes the level", () => {
    const onChange = vi.fn();
    renderToStaticMarkup(
      React.createElement(ModelVariantInlineCard, {
        variants: GPT_6_FAMILY.map((model) => resolveModelVariantFields(model)),
        embedded: true,
        defaultVariantByBaseModel: new Map([
          ["gpt-6-astra", "gpt-6-astra-high-fast"],
        ]),
        onChangeDefaultVariant: onChange,
      })
    );

    expect(slider.value).toBe(MODEL_REASONING_LEVEL.HIGH);
    expect(slider.fast).toBe(true);
    slider.onChange(MODEL_REASONING_LEVEL.MEDIUM);
    expect(onChange).toHaveBeenCalledWith(
      "gpt-6-astra",
      "gpt-6-astra-medium-fast"
    );
  });
});
