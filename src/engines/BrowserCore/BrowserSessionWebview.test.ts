// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

import { useInlineWebview } from "@src/hooks/platform/useInlineWebview";
import { getCurrentWindowLabel } from "@src/util/platform/tauri/windowIdentity";

import BrowserSessionWebview from "./BrowserSessionWebview";

vi.mock("@src/hooks/platform/useInlineWebview", () => ({
  useInlineWebview: vi.fn(() => ({})),
}));

vi.mock("@src/util/platform/tauri/windowIdentity", async (original) => ({
  ...(await original<
    typeof import("@src/util/platform/tauri/windowIdentity")
  >()),
  getCurrentWindowLabel: vi.fn(() => "main"),
}));

it("creates distinct native views for the same restored tab in three windows", () => {
  const labels: string[] = [];
  for (const windowLabel of [
    "main",
    "app-window-station-my-station",
    "app-window-station-agent-station",
  ]) {
    vi.mocked(getCurrentWindowLabel).mockReturnValue(windowLabel);
    renderToStaticMarkup(
      createElement(BrowserSessionWebview, {
        session: {
          id: "restored",
          url: "https://example.com",
          title: "Existing tab",
          history: [],
          historyIndex: 0,
          isLoading: false,
          error: null,
        },
        isActive: true,
        isTabActive: true,
        containerRef: { current: null },
        onSessionUpdate: vi.fn(),
      })
    );
    const config = vi.mocked(useInlineWebview).mock.calls.at(-1)![0];
    expect(config.useExactLabel).toBe(true);
    labels.push(config.labelPrefix!);
  }
  expect(labels[0]).toBe("browser-session-restored");
  expect(new Set(labels).size).toBe(3);
  vi.mocked(getCurrentWindowLabel).mockReturnValue("main");
});

it.each([false, true])(
  "preserves incognito=%s when a native popup creates a tab",
  (incognito) => {
    const onNewTab = vi.fn();
    renderToStaticMarkup(
      createElement(BrowserSessionWebview, {
        session: {
          id: "popup",
          url: "https://source.example",
          title: "Source",
          history: [],
          historyIndex: -1,
          isLoading: false,
          error: null,
          incognito,
        },
        isActive: true,
        isTabActive: true,
        containerRef: { current: null },
        onSessionUpdate: vi.fn(),
        onNewTab,
      })
    );
    const config = vi.mocked(useInlineWebview).mock.calls.at(-1)?.[0];
    config?.onNewWindow?.("https://popup.example");
    expect(onNewTab).toHaveBeenCalledWith("https://popup.example", incognito);
  }
);

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
