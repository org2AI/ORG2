// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

import { useInlineWebview } from "@src/hooks/platform/useInlineWebview";

import BrowserSessionWebview from "./BrowserSessionWebview";

vi.mock("@src/hooks/platform/useInlineWebview", () => ({
  useInlineWebview: vi.fn(() => ({})),
}));

it("records only the back/forward stack on native navigation", () => {
  const update = vi.fn();
  renderToStaticMarkup(
    createElement(BrowserSessionWebview, {
      session: {
        id: "test",
        url: "https://first.example",
        title: "First",
        history: ["https://first.example", "https://discarded.example"],
        historyIndex: 0,
        isLoading: false,
        error: null,
      },
      isActive: true,
      isTabActive: true,
      containerRef: { current: null },
      onSessionUpdate: update,
    })
  );
  const config = vi.mocked(useInlineWebview).mock.calls.at(-1)?.[0];
  expect(config?.onNavigate).toBeTypeOf("function");
  config?.onNavigate?.("https://next.example");
  expect(update).toHaveBeenCalledWith("test", {
    url: "https://next.example",
    title: "next.example",
    history: ["https://first.example", "https://next.example"],
    historyIndex: 1,
    isLoading: false,
  });
});
