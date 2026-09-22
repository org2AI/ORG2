import { Provider, createStore } from "jotai";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import SourceScanningSettings from "./SourceScanningSettings";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@src/components/ModelIcon", () => ({
  default: () => createElement("span", { "data-testid": "model-icon" }),
}));

describe("SourceScanningSettings", () => {
  it("keeps the table header and filters visible while inventory loads in the body", () => {
    const markup = renderToStaticMarkup(
      createElement(
        Provider,
        { store: createStore() },
        createElement(SourceScanningSettings)
      )
    );

    expect(markup).toContain('data-testid="source-scanning-settings"');
    // Page chrome belongs to the host (Settings or Runtime), not the body.
    expect(markup).not.toContain("views.scanning");
    expect(markup).toContain("table-expanded-no-hover");
    expect(markup).toContain("table-settings-expanded-compact");
    expect(markup).toContain("tabs.all");
    expect(markup).toContain("tabs.apps");
    expect(markup).toContain(">CLI<");
    expect(markup).not.toContain("tabs.clis");
    expect(markup).toContain("<thead");
    const body = markup.match(/<tbody[^>]*>[\s\S]*?<\/tbody>/)?.[0];
    expect(body).toBeDefined();
    expect(body).toContain('aria-busy="true"');
    expect(body).toContain('role="status"');
    expect(body).not.toContain("tabs.all");
    expect(markup).not.toContain("data-source-view-usage");
    expect(markup).not.toContain("data-source-scroll-region");
  });
});
