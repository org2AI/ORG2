// @vitest-environment jsdom
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ImageBottomBar } from "./ImageBottomBar";

vi.mock("@src/icons", () => ({
  ArrowExpand01Icon: "fit",
  ArrowRight02Icon: "arrow-right",
  HugeiconsIcon: ({
    icon,
    size,
    ...props
  }: {
    icon: string;
    size: number;
    [key: string]: unknown;
  }) => React.createElement("span", { ...props, "data-glyph": icon, size }),
  ZoomInIcon: "zoom-in-simple",
  ZoomOutIcon: "zoom-out-simple",
}));

describe("ImageBottomBar zoom controls", () => {
  it("uses compact image-preview icons and the simple zoom glyphs", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ImageBottomBar, {
        mode: "preview",
        metadata: null,
        fileSize: null,
        zoom: 1,
        fitMode: false,
        onFit: vi.fn(),
        onActualSize: vi.fn(),
        onZoomIn: vi.fn(),
        onZoomOut: vi.fn(),
        minZoom: 0.1,
        maxZoom: 8,
      })
    );
    const container = document.createElement("div");
    container.innerHTML = markup;

    expect(
      container.querySelector('[data-icon="maximize"]')?.getAttribute("size")
    ).toBe("14");
    expect(
      container.querySelector('[data-icon="zoom-out"]')?.getAttribute("size")
    ).toBe("14");
    expect(
      container.querySelector('[data-icon="zoom-in"]')?.getAttribute("size")
    ).toBe("14");
    expect(
      container
        .querySelector('[data-icon="zoom-out"]')
        ?.getAttribute("data-glyph")
    ).toBe("zoom-out-simple");
    expect(
      container
        .querySelector('[data-icon="zoom-in"]')
        ?.getAttribute("data-glyph")
    ).toBe("zoom-in-simple");
  });
});
