// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import EventNavigateIcon from "./EventNavigateIcon";

describe("EventNavigateIcon hit area", () => {
  it.each(["header", "footer", "footer-hover"] as const)(
    "preserves the CSS-owned width in the %s placement",
    (variant) => {
      const host = document.createElement("div");
      host.innerHTML = renderToStaticMarkup(
        createElement(EventNavigateIcon, { variant, onClick: vi.fn() })
      );
      const button = host.querySelector("button")!;
      expect(button.style.width).toBe("");
      expect(button.style.height).toBe(
        variant === "footer-hover" ? "24px" : "20px"
      );
      expect(button.querySelector("svg")).not.toBeNull();
      if (variant === "header") {
        expect(button.className.split(" ")).toContain("w-0");
        expect(button.className).toContain("group-hover/chat-block-header:w-5");
      }
    }
  );
});
