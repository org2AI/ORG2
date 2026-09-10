// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

import WebUrlBar from "../../components/WebUrlBar";
import WebViewport from "./index";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../../components/WebUrlBar", () => ({ default: vi.fn(() => null) }));
vi.mock("@/src/engines/BrowserCore", () => ({ default: () => null }));
vi.mock("../../../../hooks/useWebviewScreenshot", () => ({
  useWebviewScreenshot: () => ({}),
}));

it("keeps URL-entry back/forward behavior without timestamped recording", () => {
  const updateSession = vi.fn();
  const session = {
    id: "test",
    url: "https://first.example",
    title: "First",
    history: ["https://first.example", "https://forward.example"],
    historyIndex: 0,
    isLoading: false,
    error: null,
  };
  renderToStaticMarkup(
    createElement(WebViewport, {
      hideTabBar: true,
      browserState: {
        sessions: [session],
        activeSessionId: "test",
        activeSession: session,
        updateSession,
        addSession: vi.fn(),
        closeSession: vi.fn(),
        setActiveSession: vi.fn(),
      },
    })
  );
  const props = vi.mocked(WebUrlBar).mock.calls.at(-1)?.[0];
  expect(props?.canGoBack).toBe(false);
  expect(props?.canGoForward).toBe(true);
  props?.onForward?.();
  expect(updateSession).toHaveBeenLastCalledWith("test", {
    url: "https://forward.example",
    historyIndex: 1,
    isLoading: true,
  });
  props?.onNavigate?.("https://next.example");
  expect(updateSession).toHaveBeenLastCalledWith("test", {
    url: "https://next.example",
    isLoading: true,
    history: ["https://first.example", "https://next.example"],
    historyIndex: 1,
  });
});
