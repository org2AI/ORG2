import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import RuntimeScanningPanel from "./RuntimeScanningPanel";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@src/features/ExternalSessionSources/SourceScanningSettings", () => ({
  default: () => createElement("div", { "data-testid": "shared-scanning" }),
}));

describe("RuntimeScanningPanel", () => {
  it("wraps the shared scanning settings in Runtime's section title", () => {
    const markup = renderToStaticMarkup(createElement(RuntimeScanningPanel));

    expect(markup).toContain('data-testid="runtime-scanning-panel"');
    expect(markup).toContain('data-testid="runtime-scanning-title"');
    expect(markup).toContain("views.scanning");
    expect(markup.indexOf("runtime-scanning-title")).toBeLessThan(
      markup.indexOf("shared-scanning")
    );
  });
});
