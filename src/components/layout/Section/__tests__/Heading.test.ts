import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import SectionHeading from "../Heading";

describe("SectionHeading", () => {
  it("renders a sticky h2 section heading above its content", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        SectionHeading,
        { title: "General" },
        React.createElement("div", null, "Settings")
      )
    );

    expect(html).toContain("<h2");
    expect(html).toContain("sticky top-0");
    expect(html).toContain("General");
    expect(html).toContain("Settings");
  });
});
