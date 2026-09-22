import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { StartPageQuotaModal } from "./StartPageQuotaModal";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@src/scaffold/GlobalSpotlight/shell", () => ({
  SpotlightShell: ({
    children,
    isOpen,
    hideFooter,
  }: {
    children: React.ReactNode;
    isOpen: boolean;
    hideFooter: boolean;
  }) =>
    isOpen
      ? createElement(
          "section",
          {
            "data-testid": "quota-spotlight",
            "data-hide-footer": String(hideFooter),
          },
          children
        )
      : null,
}));
vi.mock("./StartPageQuotaGrid", () => ({
  StartPageQuotaGrid: ({
    showHeader,
    paginate,
  }: {
    showHeader: boolean;
    paginate: boolean;
  }) =>
    createElement("div", {
      "data-testid": "runtime-quota-grid",
      "data-show-header": String(showHeader),
      "data-paginate": String(paginate),
    }),
}));

describe("StartPageQuotaModal", () => {
  it("uses the Spotlight back pill and refresh slot with the Runtime quota grid", () => {
    const markup = renderToStaticMarkup(
      createElement(StartPageQuotaModal, {
        visible: true,
        onClose: vi.fn(),
      })
    );

    expect(markup).toContain('data-testid="quota-spotlight"');
    expect(markup).toContain('data-hide-footer="true"');
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('data-icon="chevron-left"');
    expect(markup).toContain('class="px-3 pb-3"');
    expect(markup).toContain("kanban.dataSource.views.quota");
    expect(markup).toContain('data-testid="quota-modal-refresh"');
    expect(markup).toContain('data-show-header="false"');
    expect(markup).toContain('data-paginate="true"');
    expect(markup).toContain("ml-auto");
    expect(markup).toContain('data-testid="runtime-quota-grid"');
    expect(markup.indexOf("quota-modal-refresh")).toBeLessThan(
      markup.indexOf("runtime-quota-grid")
    );
  });
});

it("does not render the quota grid when closed", () => {
  expect(
    renderToStaticMarkup(
      createElement(StartPageQuotaModal, { visible: false, onClose: vi.fn() })
    )
  ).toBe("");
});
