// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";

import { ArrowDown01Icon, ArrowRight01Icon } from "@src/icons";

import DisclosureChevron from "./index";
import { DISCLOSURE_CHEVRON_TOKENS } from "./tokens";

/** Reads the coordinate pairs out of a hugeicons path `d` string. */
function pathPoints(d: string): [number, number][] {
  const numbers = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  const points: [number, number][] = [];
  for (let i = 0; i + 1 < numbers.length; i += 2) {
    points.push([numbers[i]!, numbers[i + 1]!]);
  }
  return points;
}

function iconPath(icon: typeof ArrowRight01Icon): string {
  return String(icon[0]![1].d);
}

it("rotating the right chevron 90deg reproduces the down chevron exactly", () => {
  const right = pathPoints(iconPath(ArrowRight01Icon));
  const down = pathPoints(iconPath(ArrowDown01Icon));

  // The whole component rests on this: .chevron-disclosure-open rotates the
  // right chevron 90deg clockwise about the centre of the 24x24 viewBox, which
  // must land on ArrowDown01Icon. If a hugeicons upgrade redraws either glyph,
  // the rotation stops being a faithful substitute for the icon swap.
  expect(right).toHaveLength(down.length);
  right.forEach(([x, y], index) => {
    const [downX, downY] = down[index]!;
    expect(24 - y).toBeCloseTo(downX, 3);
    expect(x).toBeCloseTo(downY, 3);
  });
});

it("keeps one glyph across states and reports the direction it points", async () => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);

  try {
    await act(async () =>
      root.render(
        React.createElement(DisclosureChevron, {
          expanded: false,
          className: "text-text-3",
        })
      )
    );
    const collapsed = host.querySelector("svg")!;
    expect(collapsed.getAttribute("data-icon")).toBe("chevron-right");
    expect(collapsed.getAttribute("class")).toContain(
      DISCLOSURE_CHEVRON_TOKENS.base
    );
    expect(collapsed.getAttribute("class")).not.toContain(
      DISCLOSURE_CHEVRON_TOKENS.expanded
    );
    expect(collapsed.getAttribute("class")).toContain("text-text-3");
    const collapsedPath = collapsed.querySelector("path")!.getAttribute("d");

    await act(async () =>
      root.render(
        React.createElement(DisclosureChevron, {
          expanded: true,
          className: "text-text-3",
        })
      )
    );
    const expanded = host.querySelector("svg")!;
    expect(expanded.getAttribute("data-icon")).toBe("chevron-down");
    expect(expanded.getAttribute("class")).toContain(
      DISCLOSURE_CHEVRON_TOKENS.expanded
    );

    // Same element, same glyph — only the rotation class changed, which is what
    // lets the CSS transition run instead of the icon popping.
    expect(expanded).toBe(collapsed);
    expect(expanded.querySelector("path")!.getAttribute("d")).toBe(
      collapsedPath
    );
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
