import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import FocusView from "../SourceControlMainContent/FocusView";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("FocusView empty state", () => {
  it("asks the user to select a file instead of showing unrelated navigation", () => {
    const markup = renderToStaticMarkup(
      createElement(FocusView, {
        gitFile: null,
        loading: false,
        hasFocus: false,
      })
    );

    expect(markup).toContain("placeholders.selectSidebarFileToViewChanges");
    expect(markup).toContain("h-full");
    expect(markup).toContain("justify-center");
    expect(markup).not.toContain("<button");
    expect(markup).toContain("<svg");
  });
});
