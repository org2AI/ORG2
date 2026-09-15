// @vitest-environment jsdom
import { act, createElement, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useInlineWebview } from "../useInlineWebview";

const { invoke, navigateEvent, createdEvent, errorEvent, rect } = vi.hoisted(
  () => ({
    invoke: vi.fn(),
    navigateEvent: vi.fn(),
    createdEvent: vi.fn(),
    errorEvent: vi.fn(),
    rect: {
      x: 0,
      y: 0,
      width: 800,
      height: 600,
      top: 0,
      left: 0,
      right: 800,
      bottom: 600,
      toJSON: () => ({}),
    },
  })
);
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: "main" }),
}));
vi.mock("../webviewEnv", () => ({
  IS_TAURI: true,
  DEFAULT_USER_AGENT: "test",
  DEFAULT_POLL_INTERVAL: 0,
}));
vi.mock("../useWebviewNewWindowListener", () => ({
  useWebviewNewWindowListener: () => {},
}));
vi.mock("../useWebviewLayout", () => {
  const getContainerRect = () => rect;
  const updatePosition = async () => {};
  return { useWebviewLayout: () => ({ getContainerRect, updatePosition }) };
});
vi.mock("../useWebviewUrlPolling", () => ({
  useWebviewUrlPolling: () => () => {},
}));
vi.mock("../useInlineWebviewNativeVisibility", () => ({
  useInlineWebviewNativeVisibility: () => {},
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    rect as DOMRect
  );
  invoke.mockReset().mockResolvedValue(undefined);
  navigateEvent.mockReset();
  createdEvent.mockReset();
  errorEvent.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function Browser({ url }: { url: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    containerRef.current = document.createElement("div");
    return () => {
      containerRef.current = null;
    };
  }, []);
  useInlineWebview({
    containerRef,
    url,
    createDelay: 0,
    labelPrefix: "browser-session-test",
    useExactLabel: true,
    onNavigate: navigateEvent,
    onCreated: createdEvent,
    onError: errorEvent,
  });
  return null;
}
const tick = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });

it("reports create failure without an automatic retry loop and recovers on a new URL", async () => {
  invoke.mockRejectedValueOnce(new Error("native creation failed"));
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () =>
      root.render(createElement(Browser, { url: "https://failed.example" }))
    );
    await tick();
    await tick();
    expect(errorEvent).toHaveBeenCalledTimes(1);
    expect(createdEvent).not.toHaveBeenCalled();
    expect(
      invoke.mock.calls.filter(([name]) => name === "create_inline_webview")
    ).toHaveLength(1);
    await act(async () =>
      root.render(createElement(Browser, { url: "https://recovery.example" }))
    );
    await tick();
    expect(createdEvent).toHaveBeenCalledTimes(1);
    expect(
      invoke.mock.calls
        .filter(([name]) => name === "create_inline_webview")
        .map(([, params]) => params.url)
    ).toEqual(["https://failed.example", "https://recovery.example"]);
  } finally {
    await act(async () => root.unmount());
  }
});

it("recreates with the latest target after a pending navigation fails", async () => {
  let rejectNavigation!: (error: Error) => void;
  invoke.mockImplementation((name: string) =>
    name === "navigate_inline_webview"
      ? new Promise<void>((_resolve, reject) => {
          rejectNavigation = reject;
        })
      : Promise.resolve()
  );
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () =>
      root.render(createElement(Browser, { url: "https://initial.example" }))
    );
    await tick();
    await act(async () =>
      root.render(createElement(Browser, { url: "https://a.example" }))
    );
    await tick();
    await act(async () =>
      root.render(createElement(Browser, { url: "https://b.example" }))
    );
    await tick();
    await act(async () => rejectNavigation(new Error("webview missing")));
    await tick();
    expect(
      invoke.mock.calls
        .filter(([name]) => name === "create_inline_webview")
        .map(([, params]) => params.url)
    ).toEqual(["https://initial.example", "https://b.example"]);
    expect(navigateEvent.mock.calls.map(([url]) => url)).toEqual([
      "https://b.example",
    ]);
  } finally {
    await act(async () => root.unmount());
  }
});

it("applies B after an in-flight create A without creating a second owner", async () => {
  let resolveCreate!: () => void;
  invoke.mockImplementation((name: string) =>
    name === "create_inline_webview"
      ? new Promise<void>((resolve) => {
          resolveCreate = resolve;
        })
      : Promise.resolve()
  );
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () =>
      root.render(createElement(Browser, { url: "https://a.example" }))
    );
    await tick();
    await act(async () =>
      root.render(createElement(Browser, { url: "https://b.example" }))
    );
    await tick();
    expect(
      invoke.mock.calls.filter(([name]) => name === "create_inline_webview")
    ).toHaveLength(1);
    await act(async () => resolveCreate());
    await tick();
    expect(invoke).toHaveBeenCalledWith("navigate_inline_webview", {
      label: "browser-session-test",
      url: "https://b.example",
    });
    expect(navigateEvent).toHaveBeenCalledWith("https://b.example");
    expect(navigateEvent).not.toHaveBeenCalledWith("https://a.example");
  } finally {
    await act(async () => root.unmount());
  }
});

it("coalesces B/C while navigation A is pending and never publishes stale A", async () => {
  let finishNavigation!: () => void;
  let first = true;
  invoke.mockImplementation((name: string) => {
    if (name === "navigate_inline_webview" && first) {
      first = false;
      return new Promise<void>((resolve) => {
        finishNavigation = resolve;
      });
    }
    return Promise.resolve();
  });
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () =>
      root.render(createElement(Browser, { url: "https://initial.example" }))
    );
    await tick();
    await act(async () =>
      root.render(createElement(Browser, { url: "https://a.example" }))
    );
    await tick();
    await act(async () =>
      root.render(createElement(Browser, { url: "https://b.example" }))
    );
    await tick();
    await act(async () =>
      root.render(createElement(Browser, { url: "https://c.example" }))
    );
    await tick();
    await act(async () => finishNavigation());
    await tick();
    expect(
      invoke.mock.calls
        .filter(([name]) => name === "navigate_inline_webview")
        .map(([, params]) => params.url)
    ).toEqual(["https://a.example", "https://c.example"]);
    expect(navigateEvent.mock.calls.map(([url]) => url)).toEqual([
      "https://c.example",
    ]);
  } finally {
    await act(async () => root.unmount());
  }
});

it("late create completion after remount releases only the old unique owner", async () => {
  const completions: Array<() => void> = [];
  invoke.mockImplementation((name: string) =>
    name === "create_inline_webview"
      ? new Promise<void>((resolve) => completions.push(resolve))
      : Promise.resolve()
  );
  const container = document.createElement("div");
  let root = createRoot(container);
  try {
    await act(async () =>
      root.render(createElement(Browser, { url: "https://a.example" }))
    );
    await tick();
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () =>
      root.render(createElement(Browser, { url: "https://b.example" }))
    );
    await tick();
    const creates = invoke.mock.calls.filter(
      ([name]) => name === "create_inline_webview"
    );
    expect(creates).toHaveLength(2);
    const oldOwner = creates[0][1].generation;
    const newOwner = creates[1][1].generation;
    expect(newOwner).toBeGreaterThan(oldOwner);
    await act(async () => completions[1]());
    await act(async () => completions[0]());
    expect(createdEvent).toHaveBeenCalledTimes(1);
    const releases = invoke.mock.calls.filter(
      ([name]) => name === "close_inline_webview"
    );
    expect(releases.length).toBeGreaterThan(0);
    expect(releases.every(([, params]) => params.generation === oldOwner)).toBe(
      true
    );
    expect(
      invoke.mock.calls.filter(
        ([name]) => name === "update_inline_webview_position"
      )
    ).toHaveLength(0);
  } finally {
    await act(async () => root.unmount());
  }
});
