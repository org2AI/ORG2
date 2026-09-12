import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import SelectionGrid from "../SelectionGrid";

describe("SelectionGrid pill sizing", () => {
  it("uses leading radio indicators and shared surfaces for description choices", () => {
    const html = renderToStaticMarkup(
      React.createElement(SelectionGrid, {
        options: [
          { key: "cli", label: "CLI", description: "Account" },
          { key: "ssh", label: "SSH" },
        ],
        selected: "cli",
        onSelect: () => undefined,
        vertical: true,
        columns: 3,
        showRadio: true,
      })
    );
    expect(
      html.match(/shrink-0 items-center justify-center rounded-full border/g)
    ).toHaveLength(2);
    expect(html.match(/h-2 w-2 rounded-full bg-primary-6/g)).toHaveLength(1);
    expect(html).toContain("border-primary-6 bg-bg-2");
    expect(html).toContain("border-border-2 bg-bg-2");
    expect(html).not.toContain("bg-primary-1");
    expect(html).toContain("grid-template-columns:minmax(0, 1fr)");
  });

  it("supports vertical rows without radios or descriptions", () => {
    const html = renderToStaticMarkup(
      React.createElement(SelectionGrid, {
        options: [{ key: "a", label: "A" }],
        selected: "a",
        onSelect: () => undefined,
        vertical: true,
      })
    );
    expect(html).toContain("grid-template-columns:minmax(0, 1fr)");
    expect(html).not.toContain("h-9 px-2 py-0");
    expect(html).not.toContain("h-2 w-2 rounded-full bg-primary-6");
  });

  it("honors hidden indicators for specialized consumers", () => {
    const html = renderToStaticMarkup(
      React.createElement(SelectionGrid, {
        options: [{ key: "cli", label: "CLI" }],
        selected: "cli",
        onSelect: () => undefined,
        showSelectionCheck: false,
      })
    );
    expect(html).not.toContain("h-2 w-2 rounded-full bg-primary-6");
    expect(html).toContain('aria-pressed="true"');
  });

  it("defaults selected and unselected pills to 36px across card variants", () => {
    for (const cardVariant of [
      "default",
      "subtle",
      "primary",
      "secondary",
    ] as const) {
      const html = renderToStaticMarkup(
        React.createElement(SelectionGrid, {
          options: [
            { key: "global", label: "Global" },
            { key: "china", label: "China" },
          ],
          selected: "global",
          onSelect: () => undefined,
          cardVariant,
        })
      );
      expect(html.match(/h-9 px-2 py-0/g)).toHaveLength(2);
      expect(html).toContain('aria-pressed="true"');
      expect(html).toContain('aria-pressed="false"');
      expect(html).not.toContain("h-2 w-2 rounded-full bg-primary-6");
    }
  });

  it("keeps description cards at content height", () => {
    const html = renderToStaticMarkup(
      React.createElement(SelectionGrid, {
        options: [
          { key: "cloud", label: "Cloud", description: "Connect your account" },
        ],
        selected: "cloud",
        onSelect: () => undefined,
      })
    );
    expect(html).toContain("Connect your account");
    expect(html).not.toContain("h-9 px-2 py-0");
  });
});
