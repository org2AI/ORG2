// @vitest-environment jsdom
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useInlineWebview } from "@src/hooks/platform/useInlineWebview";

import BrowserSessionWebview from "./BrowserSessionWebview";
import type { BrowserSession } from "./types";

const reload = vi.fn(() => Promise.resolve());

vi.mock("@src/hooks/platform/useInlineWebview", () => ({
  useInlineWebview: vi.fn(() => ({
    reload,
    updatePosition: vi.fn(() => Promise.resolve()),
    pollNow: vi.fn(() => Promise.resolve()),
    isWebviewAvailable: true,
    isWebviewCreated: true,
  })),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

const HISTORY = ["https://a.example", "https://b.example"];

const SESSION: BrowserSession = {
  id: "nav",
  url: "https://b.example",
  title: "B",
  history: HISTORY,
  historyIndex: 1,
  isLoading: false,
  error: null,
};

let root: Root | null = null;

async function render(session: BrowserSession) {
  if (!root) root = createRoot(document.createElement("div"));
  const mounted = root;
  await act(async () => {
    mounted.render(
      createElement(BrowserSessionWebview, {
        session,
        isActive: true,
        isTabActive: true,
        containerRef: { current: null },
        onSessionUpdate: vi.fn(),
      })
    );
  });
}

function latestConfig() {
  return vi.mocked(useInlineWebview).mock.calls.at(-1)![0];
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  reload.mockClear();
});

afterEach(async () => {
  const mounted = root;
  root = null;
  if (mounted) await act(async () => mounted.unmount());
  vi.unstubAllGlobals();
});

it("reloads when loading is requested for the page already shown", async () => {
  await render(SESSION);
  await render({ ...SESSION, isLoading: true });

  expect(reload).toHaveBeenCalledTimes(1);
});

it("does not reload the page being left when the URL changes", async () => {
  await render(SESSION);
  // handleNavigate: new URL, rebuilt history, isLoading in the same update.
  await render({
    ...SESSION,
    url: "https://c.example",
    history: [...HISTORY, "https://c.example"],
    historyIndex: 2,
    isLoading: true,
  });

  expect(reload).not.toHaveBeenCalled();
});

it("creates the webview without the hook's default settle delay", async () => {
  await render(SESSION);

  expect(latestConfig().createDelay).toBe(0);
});

it("marks a Back step for exactly the navigation that performs it", async () => {
  await render(SESSION);
  // handleBack: same history array, cursor one entry down.
  await render({
    ...SESSION,
    url: "https://a.example",
    historyIndex: 0,
    isLoading: true,
  });

  const resolve = latestConfig().resolveHistoryDirection!;
  expect(resolve("https://a.example")).toBe("back");
  // Consumed: a later navigation to the same URL is an ordinary load.
  expect(resolve("https://a.example")).toBeNull();
  expect(reload).not.toHaveBeenCalled();
});

it("does not mark a typed navigation as a history step", async () => {
  await render({ ...SESSION, url: "https://a.example", historyIndex: 0 });
  // Typing b again from index 0 rebuilds the same entries at index + 1.
  await render({
    ...SESSION,
    history: [...HISTORY],
    isLoading: true,
  });

  expect(
    latestConfig().resolveHistoryDirection!("https://b.example")
  ).toBeNull();
});
