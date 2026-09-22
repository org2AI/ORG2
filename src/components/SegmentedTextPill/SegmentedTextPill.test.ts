import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import SegmentedTextPill from ".";

const mocks = vi.hoisted(() => ({ isDark: false }));

vi.mock("@src/util/ui/theme/themeUtils", () => ({
  useCurrentTheme: () => ({
    theme: mocks.isDark ? "dark" : "light",
    isDark: mocks.isDark,
  }),
}));

const options = [
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
];

function renderPill(size?: "small" | "default" | "large"): string {
  return renderToStaticMarkup(
    createElement(SegmentedTextPill, {
      ariaLabel: "Position",
      onChange: () => undefined,
      options,
      size,
      value: "left",
    })
  );
}

describe("SegmentedTextPill", () => {
  beforeEach(() => {
    mocks.isDark = false;
  });

  it("preserves the established dimensions by default", () => {
    const markup = renderPill();

    expect(markup).toContain("h-[28px]");
    expect(markup).toContain("h-6 px-2.5");
  });

  it("offers a smaller variant for compact setting rows", () => {
    const markup = renderPill("small");

    expect(markup).toContain("h-6 text-[11px]");
    expect(markup).toContain("h-5 px-2");
    expect(markup).toContain('aria-label="Position"');
  });

  it("offers a 32px regular-weight variant matching default settings inputs", () => {
    const markup = renderPill("large");

    expect(markup).toContain("h-8 text-sm font-normal");
    expect(markup).toContain("h-7 px-3");
    expect(markup).toContain("inline-flex items-center justify-center");
    expect(markup).toContain("bg-fill-2");
    expect(markup).not.toContain("bg-fill-3");
    expect(markup).toContain("bg-bg-2 text-text-1 font-normal shadow-none");
    expect(markup).not.toContain("shadow-dropdown-soft");
  });

  it("uses fill-3 in dark mode", () => {
    mocks.isDark = true;

    const markup = renderPill("large");

    expect(markup).toContain("bg-fill-3");
    expect(markup).not.toContain("bg-fill-2");
  });

  it("renders no selected segment when value is null", () => {
    const markup = renderToStaticMarkup(
      createElement(SegmentedTextPill, {
        ariaLabel: "Position",
        onChange: () => undefined,
        options,
        value: null,
      })
    );

    expect(markup).not.toContain('aria-pressed="true"');
  });

  it("uses the shared dropdown-soft shadow for the selected segment", () => {
    const markup = renderPill();

    expect(markup).toContain("shadow-dropdown-soft");
    expect(markup).toContain("font-medium");
  });
});
