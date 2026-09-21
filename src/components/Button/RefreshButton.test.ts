import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import RefreshButton from "./RefreshButton";

describe("RefreshButton", () => {
  it("uses the shared compact text-only refresh props with a hover surface", () => {
    const markup = renderToStaticMarkup(
      createElement(RefreshButton, {
        label: "Refresh",
        onRefresh: vi.fn(),
        refreshing: false,
        dataTestId: "page-refresh",
      })
    );

    expect(markup).toContain('data-testid="page-refresh"');
    expect(markup).toContain("btn:border-0 btn:bg-transparent btn:text-text-2");
    expect(markup).toContain("btn-hover:bg-surface-hover");
    expect(markup).toContain("height:28px");
    expect(markup).toContain('data-icon="refresh-cw"');
    expect(markup).toContain("Refresh");
  });

  it("renders secondary refresh as a bordered icon-only toolbar button", () => {
    const markup = renderToStaticMarkup(
      createElement(RefreshButton, {
        label: "Rescan all",
        variant: "secondary",
        iconOnly: true,
        onRefresh: vi.fn(),
        refreshing: false,
      })
    );

    expect(markup).toContain(
      "btn:border btn:border-border-2 btn:bg-bg-2 btn:text-text-1"
    );
    expect(markup).toContain("height:32px");
    expect(markup).toContain("width:32px");
    expect(markup).toContain('aria-label="Rescan all"');
    expect(markup).toContain('title="Rescan all"');
    // Icon-only: the label lives in aria-label and title, never as text.
    expect(markup.split("Rescan all")).toHaveLength(3);
  });
});
