import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ArrowLeft01Icon } from "@src/icons";

import SidebarHeaderNavButton from "./SidebarHeaderNavButton";

describe("SidebarHeaderNavButton", () => {
  it("uses the shared 28px sidebar row height", () => {
    const markup = renderToStaticMarkup(
      createElement(SidebarHeaderNavButton, {
        icon: ArrowLeft01Icon,
        label: "Work Items",
        onClick: vi.fn(),
      })
    );

    expect(markup).toContain("group mt-1 flex h-7 w-full");
    expect(markup).toContain("items-center gap-3");
    expect(markup).toContain("flex min-w-0 flex-1 flex-col gap-0");
    expect(markup).not.toContain("min-h-[36px]");
  });

  it("left-aligns the label inside the native button", () => {
    const markup = renderToStaticMarkup(
      createElement(SidebarHeaderNavButton, {
        icon: ArrowLeft01Icon,
        label: "Settings",
        onClick: vi.fn(),
      })
    );

    // A native <button> centers inherited text; the flex-1 label column
    // spans the row, so without text-left the label drifts off the icon.
    expect(markup).toMatch(/^<button[^>]*\stext-left\s/);
  });

  it("keeps the row full-width when a shortcut badge is attached", () => {
    const markup = renderToStaticMarkup(
      createElement(SidebarHeaderNavButton, {
        icon: ArrowLeft01Icon,
        label: "Settings",
        ariaLabel: "Close Settings",
        shortcutId: "close_tab",
        onClick: vi.fn(),
      })
    );

    // The shortcut renders inline (hover-revealed), not through a Tooltip
    // wrapper, so the button stays the top-level element.
    expect(markup).toMatch(/^<button/);
    expect(markup).toContain("group mt-1 flex h-7 w-full");
    expect(markup).toContain('aria-label="Close Settings"');
    expect(markup).toContain("group-hover:opacity-100");
  });
});
