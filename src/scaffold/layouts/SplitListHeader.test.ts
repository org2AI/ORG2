import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import SplitListHeader from "./SplitListHeader";

describe("SplitListHeader", () => {
  it("renders its rows without a bottom divider", () => {
    const markup = renderToStaticMarkup(
      createElement(SplitListHeader, {
        primary: createElement("span", null, "Context"),
        secondary: createElement("span", null, "Search"),
      })
    );

    expect(markup).toContain('data-split-list-header="true"');
    expect(markup.indexOf("Search")).toBeLessThan(markup.indexOf("Context"));
    expect(markup).not.toContain("border-b");
    expect(markup).not.toContain("border-border-2");
  });

  it("keeps the list's left inset for full-width surface rows", () => {
    const markup = renderToStaticMarkup(
      createElement(SplitListHeader, {
        fullWidth: true,
        primary: createElement("span", null, "Controls"),
        secondary: createElement("span", null, "Search"),
      })
    );

    expect(markup.indexOf("Controls")).toBeLessThan(markup.indexOf("Search"));
    expect(markup).toContain("h-9");
    expect(markup.match(/pl-3/g)).toHaveLength(2);
    expect(markup).not.toContain("pl-[15px]");
    expect(markup).toContain("pr-[7px]");
  });
});
