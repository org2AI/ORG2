import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import PillGroup, { type PillGroupSegment } from ".";

function renderStrongSegment(active = false): string {
  const segments: PillGroupSegment[] = [
    {
      id: "repo",
      icon: null,
      label: "ORGII",
      active,
    },
  ];

  return renderToStaticMarkup(
    createElement(PillGroup, { segments, strongSurface: true })
  );
}

describe("PillGroup", () => {
  it("opts only the flexible segment into remaining-width sizing", () => {
    const markup = renderToStaticMarkup(
      createElement(PillGroup, {
        segments: [
          { id: "repo", icon: null, label: "ORGII", maxLabelWidth: 180 },
          {
            id: "branch",
            icon: null,
            label: "dev/long-branch",
            flexible: true,
          },
        ],
      })
    );
    const buttons = markup.match(/<button\b[^>]*>/g);
    expect(buttons).toHaveLength(2);
    expect(buttons![0]).not.toContain("flex-1");
    expect(buttons![1]).toContain("min-w-12 flex-1");
    expect(markup).toContain("max-width:180px");
  });

  it("gives strong segments a hover surface", () => {
    const markup = renderStrongSegment();

    expect(markup).toContain("enabled:hover:bg-fill-3!");
    expect(markup).not.toContain("enabled:hover:bg-surface-hover!");
  });

  it("keeps the surface while a strong segment is active", () => {
    expect(renderStrongSegment(true)).toContain("bg-fill-3!");
  });

  it("uses a higher-contrast surface when requested", () => {
    const segments: PillGroupSegment[] = [
      { id: "location", icon: null, label: "Local" },
    ];
    const markup = renderToStaticMarkup(
      createElement(PillGroup, { segments, strongSurface: true })
    );

    expect(markup).toContain("enabled:hover:bg-fill-3!");
  });

  it("keeps the higher-contrast surface while open", () => {
    const segments: PillGroupSegment[] = [
      { id: "branch", icon: null, label: "develop", active: true },
    ];
    const markup = renderToStaticMarkup(
      createElement(PillGroup, { segments, strongSurface: true })
    );

    expect(markup).toContain("bg-fill-3!");
  });
});
