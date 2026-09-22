import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  RUNTIME_PAGE_BODY,
  RUNTIME_PAGE_SCROLL,
  RUNTIME_PAGE_TRACK,
  RuntimePageBody,
} from "./RuntimePageLayout";

describe("RuntimePageLayout", () => {
  it("puts headers and content on one padded 932px track", () => {
    // 932px of shell minus two 16px gutters is the 900px content measure every
    // other detail surface uses. A page that centred on 932px without the
    // gutters — the builder-types gallery did — ran 32px wide.
    expect(RUNTIME_PAGE_TRACK).toContain("max-w-[932px]");
    expect(RUNTIME_PAGE_TRACK).toContain("mx-auto");
    expect(RUNTIME_PAGE_TRACK).toContain("px-4");
    expect(RUNTIME_PAGE_BODY).toContain(RUNTIME_PAGE_TRACK);
  });

  it("keeps gutters off the scroll region", () => {
    // Padding on the scroller sits outside the centred column, so the content
    // stops lining up with the header once the pane is narrower than a track.
    expect(RUNTIME_PAGE_SCROLL).not.toMatch(/\bp[xylrtb]?-\d/);
    expect(RUNTIME_PAGE_SCROLL).toContain("overflow-y-auto");
    expect(RUNTIME_PAGE_SCROLL).toContain("min-h-0");
  });

  it("renders the content column with the section gap and bottom affordance", () => {
    const markup = renderToStaticMarkup(
      createElement(
        RuntimePageBody,
        { dataTestId: "runtime-body", className: "extra" },
        createElement("p", null, "section")
      )
    );

    expect(markup).toContain('data-testid="runtime-body"');
    expect(markup).toContain("max-w-[932px]");
    expect(markup).toContain("px-4");
    expect(markup).toContain("gap-3");
    // The header is a sibling, so the column opens the same gap above its
    // first section that it keeps between them.
    expect(markup).toContain("pt-3");
    expect(markup).toContain("pb-[25vh]");
    expect(markup).toContain("extra");
    expect(markup).toContain("section");
  });
});
