import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import SplitButton from ".";

type SplitColor =
  | "primary"
  | "secondary"
  | "danger"
  | "warning"
  | "success"
  | "merged";

/** Neutral colors are variants; semantic ones are a toned primary. */
function renderSplitButton(color: SplitColor, menuOpen = false): string {
  const neutral = color === "primary" || color === "secondary";
  return renderToStaticMarkup(
    React.createElement(
      SplitButton,
      {
        variant: neutral ? color : "primary",
        tone: neutral ? undefined : color,
        menu: React.createElement("div", { "data-testid": "menu" }),
        menuOpen,
        onMenuButtonClick: vi.fn(),
        menuButtonLabel: "More actions",
      },
      "Action"
    )
  );
}

function menuButtonClassName(markup: string): string {
  const buttonClassNames = [...markup.matchAll(/<button[^>]*class="([^"]*)"/g)];
  return buttonClassNames.at(-1)?.[1] ?? "";
}

describe("SplitButton", () => {
  it("uses the success tone while hovered or open", () => {
    expect(menuButtonClassName(renderSplitButton("success"))).toContain(
      "enabled:hover:bg-success-fill-hover"
    );
    expect(menuButtonClassName(renderSplitButton("success", true))).toContain(
      "bg-success-fill-hover enabled:hover:bg-success-fill-hover"
    );
  });

  it("uses GitHub purple for the merged variant and its open state", () => {
    expect(menuButtonClassName(renderSplitButton("merged"))).toContain(
      "enabled:hover:bg-merged-hover"
    );
    expect(menuButtonClassName(renderSplitButton("merged", true))).toContain(
      "bg-merged-hover enabled:hover:bg-merged-hover"
    );
  });

  it.each([
    ["primary", "primary"],
    ["danger", "danger"],
    ["warning", "warning"],
  ] as const)("uses the %s tone for its semantic variant", (variant, tone) => {
    expect(menuButtonClassName(renderSplitButton(variant))).toContain(
      `enabled:hover:bg-${tone}-5`
    );
  });

  it("keeps neutral solid split buttons neutral", () => {
    expect(menuButtonClassName(renderSplitButton("secondary"))).toContain(
      "enabled:hover:bg-fill-3"
    );
  });

  it("keeps the main segment light while the menu segment has a stronger hover fill", () => {
    const markup = renderToStaticMarkup(
      React.createElement(SplitButton, {
        variant: "tertiary",
        menu: React.createElement("div"),
        menuOpen: false,
        onMenuButtonClick: vi.fn(),
        menuButtonLabel: "Choose shell",
      })
    );
    const classes = [...markup.matchAll(/<button[^>]*class="([^"]*)"/g)];
    expect(classes).toHaveLength(2);
    expect(classes[0][1]).toContain(
      "group-hover/button-split:bg-button-hover-no-drop"
    );
    expect(classes[0][1]).toContain("btn-hover:bg-surface-hover");
    // The menu segment's own stronger fill is a caller class, so it overrides
    // the tertiary hover default the underlying Button still emits.
    const menuClasses = classes[1][1].split(" ");
    expect(menuClasses).toContain("enabled:hover:bg-button-hover");
    expect(menuClasses).toContain("focus-visible:bg-button-hover");
    expect(menuClasses).not.toContain("enabled:hover:bg-button-hover-no-drop");
  });

  it.each([false, true])(
    "retains open highlights only while enabled (disabled=%s)",
    (disabled) => {
      const markup = renderToStaticMarkup(
        React.createElement(SplitButton, {
          variant: "tertiary",
          menu: React.createElement("div"),
          menuOpen: true,
          disabled,
          onMenuButtonClick: vi.fn(),
          menuButtonLabel: "Choose shell",
        })
      );
      const classes = [...markup.matchAll(/<button[^>]*class="([^"]*)"/g)];
      const mainClasses = classes[0][1].split(" ");
      const menuClasses = classes[1][1].split(" ");
      expect(mainClasses.includes("bg-button-hover-no-drop!")).toBe(!disabled);
      expect(mainClasses.includes("text-primary-6!")).toBe(!disabled);
      expect(menuClasses.includes("bg-button-hover")).toBe(!disabled);
      expect(menuClasses.includes("text-primary-6")).toBe(!disabled);
    }
  );

  it("puts menu semantics and the accessible name on the menu trigger", () => {
    const markup = renderSplitButton("primary", true);
    const buttons = [...markup.matchAll(/<button([^>]*)>/g)];
    const mainButton = buttons[0]?.[1] ?? "";
    const menuButton = buttons[1]?.[1] ?? "";

    expect(mainButton).not.toContain("aria-expanded");
    expect(menuButton).toContain('aria-label="More actions"');
    expect(menuButton).toContain('aria-haspopup="menu"');
    expect(menuButton).toContain('aria-expanded="true"');
  });

  it("renders the controlled menu only while open", () => {
    expect(renderSplitButton("primary")).not.toContain('data-testid="menu"');
    expect(renderSplitButton("primary", true)).toContain('data-testid="menu"');
  });

  it("disables both segments while loading", () => {
    const markup = renderToStaticMarkup(
      React.createElement(
        SplitButton,
        {
          loading: true,
          menu: React.createElement("div"),
          menuOpen: false,
          onMenuButtonClick: vi.fn(),
          menuButtonLabel: "More actions",
        },
        "Action"
      )
    );

    expect([...markup.matchAll(/<button[^>]* disabled=""/g)]).toHaveLength(2);
  });

  it("preserves explicit icon-only segment widths", () => {
    const markup = renderToStaticMarkup(
      React.createElement(SplitButton, {
        iconOnly: true,
        icon: React.createElement("span"),
        mainSegmentWidth: 40,
        menuSegmentWidth: 20,
        menu: React.createElement("div"),
        menuOpen: false,
        onMenuButtonClick: vi.fn(),
        menuButtonLabel: "More actions",
      })
    );

    expect(markup).toContain("width:60px");
    expect(markup).toContain("width:20px");
  });
});

describe("SplitButton divider", () => {
  it("draws an inset border-colored divider at the menu segment's leading edge", () => {
    const markup = renderSplitButton("danger");
    const menuButton = markup.slice(markup.lastIndexOf("<button"));
    expect(menuButton).toMatch(
      /<span[^>]*data-split-divider[^>]*class="[^"]*top-1\/4 bottom-1\/4 left-0 w-\[0\.5px\] bg-border-1"/
    );
  });
});
