import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RuntimeSectionHeader } from "./RuntimeSectionHeader";

describe("RuntimeSectionHeader", () => {
  it("keeps title and actions on the shared heading row", () => {
    const markup = renderToStaticMarkup(
      createElement(
        RuntimeSectionHeader,
        {
          title: "Profile",
          headingLevel: "h2",
          dataTestId: "runtime-title",
        },
        createElement("span", null, "action")
      )
    );

    expect(markup).toContain('data-testid="runtime-title"');
    expect(markup).toContain("<h2");
    expect(markup).toContain("Profile");
    expect(markup).toContain("action");
  });
});
