// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import {
  TREE_INDENT_PX,
  TREE_PADDING_RIGHT,
  TREE_PADDING_X,
  TREE_ROW_INSET_X,
} from "@src/components/TreeRow/config";

import { StickyTreeRow } from "./StickyTreeRow";

it("insets only the hit surface, preserves tree alignment and forwards scroll-to-reveal", async () => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const reveal = vi.fn();
  try {
    for (const depth of [0, 1, 4]) {
      await act(async () =>
        root.render(
          React.createElement(
            StickyTreeRow,
            {
              depth,
              expanded: true,
              name: "public",
              onClick: reveal,
              stickyBgClass: "bg-bg-2",
              title: "Scroll to public",
            },
            React.createElement("span", null, "3")
          )
        )
      );
      const button = host.querySelector("button")!;
      expect(button.parentElement!.className).toContain("bg-bg-2");
      expect(button.parentElement!.className).toContain("px-1");
      expect(button.className).toContain("rounded-md");
      expect(button.className).toContain("w-full");
      expect(parseFloat(button.style.paddingLeft) + TREE_ROW_INSET_X).toBe(
        TREE_PADDING_X + depth * TREE_INDENT_PX
      );
      expect(parseFloat(button.style.paddingRight) + TREE_ROW_INSET_X).toBe(
        TREE_PADDING_RIGHT
      );
      expect(button.title).toBe("Scroll to public");
      expect(button.textContent).toBe("public3");
      expect(button.type).toBe("button");
      await act(async () => button.click());
    }
    expect(reveal).toHaveBeenCalledTimes(3);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  }
});
