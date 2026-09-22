import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import { SidebarRow } from ".";
import { SidebarRowContent } from "./SidebarRowContent";

it("shares one inset and radius across flat, indented, disabled and graph rows", () => {
  for (const indented of [false, true]) {
    for (const compact of [false, true]) {
      const html = renderToStaticMarkup(
        React.createElement(SidebarRow, {
          label: "Title",
          metadata: "Metadata",
          indented,
          compact,
          disabled: true,
          icon: React.createElement("svg", { width: 12, height: 12 }),
        })
      );
      expect(html.match(/mx-1/g)).toHaveLength(1);
      expect(html.match(/pb-px/g)).toHaveLength(1);
      expect(html.match(/rounded-md/g)).toHaveLength(1);
      expect(html).toContain(`padding-left:${indented ? 20 : 12}px`);
      expect(html).toContain("padding-right:4px");
      expect(html).toContain("disabled");
      expect(html).toContain(compact ? "leading-4" : "leading-5");
      expect(html).not.toContain("rounded-lg");
    }
  }
});

it("keeps content slots without inventing metadata for single-line rows", () => {
  const html = renderToStaticMarkup(
    React.createElement(SidebarRowContent, {
      label: "Name",
      leading: React.createElement("span", null, "Icon"),
      trailing: React.createElement("span", null, "Status"),
    })
  );
  expect(html.indexOf("Icon")).toBeLessThan(html.indexOf("Name"));
  expect(html.indexOf("Name")).toBeLessThan(html.indexOf("Status"));
  expect(html).not.toContain("text-[11px]");
});
