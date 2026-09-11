// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import Button from ".";

function readThemeColor(css: string, token: string): string {
  const match = css.match(
    new RegExp(`--color-${token}:\\s*(#[0-9a-f]{6})`, "i")
  );
  if (!match?.[1]) throw new Error(`Missing theme color: ${token}`);
  return match[1];
}

function relativeLuminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)
    ?.map((channel) => Number.parseInt(channel, 16) / 255);
  if (!channels || channels.length !== 3) return 0;
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  );
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function contrastRatio(first: string, second: string): number {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  return (
    (Math.max(firstLuminance, secondLuminance) + 0.05) /
    (Math.min(firstLuminance, secondLuminance) + 0.05)
  );
}

describe("Button", () => {
  it("uses GitHub purple for the merged variant", () => {
    const markup = renderToStaticMarkup(
      React.createElement(Button, { variant: "merged" }, "Merged")
    );
    expect(markup).toContain("bg-merged");
    expect(markup).toContain("text-merged-contrast");
  });

  it("keeps icon + label centered as one group by default", () => {
    const markup = renderToStaticMarkup(
      React.createElement(
        Button,
        { icon: React.createElement("i", null), long: true },
        "Close"
      )
    );
    expect(markup).not.toContain("right-full");
    expect(markup).toContain("mr-2");
  });

  it("lifts the icon out of flow so centerLabel centers the label alone", () => {
    const markup = renderToStaticMarkup(
      React.createElement(
        Button,
        { icon: React.createElement("i", null), long: true, centerLabel: true },
        "Close"
      )
    );
    // Icon anchored to the label's left edge (right: 100%) plus its mr-2 gap,
    // so only the label participates in the button's centering.
    expect(markup).toContain("absolute inset-y-0 inline-flex items-center");
    expect(markup).toContain("right-full");
  });

  it("keeps a right-positioned icon out of flow under centerLabel", () => {
    const markup = renderToStaticMarkup(
      React.createElement(
        Button,
        {
          icon: React.createElement("i", null),
          iconPosition: "right",
          long: true,
          centerLabel: true,
        },
        "Close"
      )
    );
    expect(markup).toContain("left-full");
    expect(markup).not.toContain("right-full");
  });

  it.each(["orgii_main.css", "orgii_dark.css"])(
    "keeps merged button states readable in %s",
    (themeFile) => {
      const css = readFileSync(resolve("public", themeFile), "utf8");
      const foreground = readThemeColor(css, "merged-button-contrast");

      for (const token of [
        "merged-button-bg",
        "merged-button-hover",
        "merged-button-active",
      ]) {
        expect(
          contrastRatio(foreground, readThemeColor(css, token)),
          `${themeFile} ${token}`
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  );
});

describe("compact shared actions", () => {
  beforeAll(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  });
  afterAll(() => {
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  });
  it("renders the sidebar icon at 20px with the standard 8px radius", () => {
    const markup = renderToStaticMarkup(
      React.createElement(Button, {
        size: "sidebar",
        variant: "tertiary",
        appearance: "soft",
        iconOnly: true,
        icon: React.createElement("svg", { "data-testid": "action-icon" }),
        "aria-label": "Stage file",
      })
    );
    expect(markup).toContain("height:20px");
    expect(markup).toContain("width:20px");
    expect(markup).toContain("border-radius:8px");
    expect(markup).toContain("action-icon");
    expect(markup).toContain("enabled:hover:bg-button-hover");
    expect(markup).not.toContain("enabled:hover:bg-primary-3");
  });

  it("keeps compact non-sidebar actions at 24px", () => {
    const markup = renderToStaticMarkup(
      React.createElement(Button, {
        size: "mini",
        iconOnly: true,
        icon: React.createElement("svg"),
      })
    );
    expect(markup).toContain("width:24px");
    expect(markup).toContain("border-radius:8px");
  });

  it("keeps danger actions light and respects native disabled behavior", async () => {
    let clicks = 0;
    const props = {
      size: "sidebar" as const,
      variant: "danger" as const,
      appearance: "soft" as const,
      iconOnly: true,
      "aria-label": "Discard file",
      icon: React.createElement("svg"),
      onClick: () => {
        clicks += 1;
      },
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(React.createElement(Button, props)));
      const button = container.querySelector("button")!;
      expect(button.getAttribute("aria-label")).toBe("Discard file");
      expect(button.className).toContain("enabled:hover:bg-danger-1");
      expect(button.className).not.toContain("bg-danger-3");
      await act(async () => button.click());
      expect(clicks).toBe(1);
      await act(async () =>
        root.render(React.createElement(Button, { ...props, disabled: true }))
      );
      await act(async () => button.click());
      expect(clicks).toBe(1);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
