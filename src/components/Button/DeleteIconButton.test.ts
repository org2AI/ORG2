import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import DeleteIconButton from "./DeleteIconButton";

describe("DeleteIconButton", () => {
  it("carries danger through the Button tone, not a text-color class", () => {
    const markup = renderToStaticMarkup(
      createElement(DeleteIconButton, {
        label: "Remove",
        onDelete: vi.fn(),
        dataTestId: "row-remove",
      })
    );

    expect(markup).toContain('data-testid="row-remove"');
    expect(markup).toContain('data-icon="trash-2"');
    expect(markup).toContain("btn:text-danger-6");
    expect(markup).toContain('aria-label="Remove"');
    expect(markup).toContain('title="Remove"');
    // Icon-only by default: the label lives in aria-label and title only.
    expect(markup.split("Remove")).toHaveLength(3);
  });

  it("renders a labelled destructive action with iconOnly disabled", () => {
    const markup = renderToStaticMarkup(
      createElement(DeleteIconButton, {
        label: "Delete",
        variant: "tertiary",
        size: "small",
        iconOnly: false,
        onDelete: vi.fn(),
      })
    );

    expect(markup).toContain("btn:text-danger-6");
    expect(markup).toContain("height:28px");
    expect(markup).toContain("Delete");
  });

  it("blocks clicks while a removal is in flight", () => {
    const markup = renderToStaticMarkup(
      createElement(DeleteIconButton, {
        label: "Remove",
        onDelete: vi.fn(),
        deleting: true,
      })
    );

    expect(markup).toContain("disabled");
  });
});
