import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import SelectionGrid from "../SelectionGrid";

describe("SelectionGrid pill sizing", () => {
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
