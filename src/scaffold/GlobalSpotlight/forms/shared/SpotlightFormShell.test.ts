import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SpotlightFormBody, SpotlightFormShell } from "./SpotlightFormShell";

describe("SpotlightFormShell", () => {
  it("leaves the outer border and radius to the Spotlight shell", () => {
    const markup = renderToStaticMarkup(
      createElement(
        SpotlightFormShell,
        null,
        createElement(SpotlightFormBody, null, "Form content")
      )
    );

    const shellClasses = markup.match(/^<div class="([^"]+)"/)?.[1].split(" ");
    expect(shellClasses).toEqual(
      expect.arrayContaining([
        "overflow-hidden",
        "bg-chat-input",
        "[--modal-chrome-padding:--spacing(3)]",
      ])
    );
    expect(markup).toContain('class="px-3 pb-3"');
    expect(markup).not.toContain("border");
    expect(markup).not.toContain("rounded");
  });
});
