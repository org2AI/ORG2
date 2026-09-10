import { Provider, createStore } from "jotai";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import RuntimeScanningPanel from "./RuntimeScanningPanel";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@src/components/ModelIcon", () => ({
  default: () => createElement("span", { "data-testid": "model-icon" }),
}));

describe("RuntimeScanningPanel", () => {
  it("keeps the table header and filters visible while inventory loads in the body", () => {
    const markup = renderToStaticMarkup(
      createElement(
        Provider,
        { store: createStore() },
        createElement(RuntimeScanningPanel)
      )
    );

    expect(markup).toContain('data-testid="runtime-scanning-title"');
    expect(markup).toContain("views.scanning");
    expect(markup).toContain("table-expanded-no-hover");
    expect(markup).toContain("table-settings-expanded-compact");
    expect(markup).toContain("tabs.all");
    expect(markup).toContain("tabs.apps");
    expect(markup).toContain("tabs.clis");
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
