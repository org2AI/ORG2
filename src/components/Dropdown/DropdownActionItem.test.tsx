import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import DropdownActionItem from "./DropdownActionItem";

describe("DropdownActionItem", () => {
  it("uses standard dropdown-row geometry and anchors shortcuts at the trailing edge", () => {
    const markup = renderToStaticMarkup(
      <DropdownActionItem icon={<svg data-icon="folder" />} shortcut="Meta+G">
        Files
      </DropdownActionItem>
    );

    expect(markup).toContain('role="menuitem"');
    expect(markup).toContain("h-8");
    expect(markup).toContain("text-[13px]");
    expect(markup).toContain("ml-auto");
    expect(markup).toContain("Meta");
    expect(markup).toContain("Files");
  });

  it("keeps submenu suffixes in the same trailing slot", () => {
    const markup = renderToStaticMarkup(
      <DropdownActionItem suffix={<svg data-icon="chevron-right" />}>
        Appearance
      </DropdownActionItem>
    );

    expect(markup).toContain("ml-auto");
    expect(markup).toContain("chevron-right");
  });
});
