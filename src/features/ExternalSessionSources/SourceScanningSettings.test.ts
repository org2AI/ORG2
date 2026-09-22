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
  it("keeps the toolbar visible while the inventory loads into the card body", () => {
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
    expect(markup).toContain("tabs.all");
    expect(markup).toContain("tabs.apps");
    expect(markup).toContain(">CLI<");
    expect(markup).not.toContain("tabs.clis");
    // Cards are the default presentation, so the inventory renders no table
    // head or body — the list view stays one toggle away.
    expect(markup).not.toContain("<thead");
    expect(markup).not.toContain("<tbody");
    expect(markup).toContain('data-testid="settings-table-view-toggle"');
    // The loading state belongs to the body, below the toolbar that owns the
    // tabs, so the filters stay usable while detection runs.
    const [toolbar, loadingBody] = markup.split('role="status"');
    expect(loadingBody).toBeDefined();
    expect(toolbar).toContain("tabs.all");
    expect(loadingBody).not.toContain("tabs.all");
    expect(markup).toContain('aria-busy="true"');
    expect(markup).not.toContain("data-source-view-usage");
    expect(markup).not.toContain("data-source-scroll-region");
  });
});
