// @vitest-environment jsdom
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useWebviewLayout } from "../useWebviewLayout";

const invokeMock = vi.fn((..._args: unknown[]) => Promise.resolve());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

const FRAME = { left: 40, top: 80, right: 840, bottom: 680 };
const LABEL = "browser-session-layout";

function createMeasuredContainer(): HTMLDivElement {
  const container = document.createElement("div");
  container.getBoundingClientRect = () =>
    ({
      ...FRAME,
      x: FRAME.left,
      y: FRAME.top,
      width: FRAME.right - FRAME.left,
      height: FRAME.bottom - FRAME.top,
      toJSON: () => ({}),
    }) as DOMRect;
  return container;
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;
const measured = createMeasuredContainer();

// Driven through rendered buttons rather than a captured return value:
// reassigning an outer binding during render is a side effect the hook rules
// reject.
function Probe(props: { isVisible: boolean }) {
  const { updatePosition, parkOffscreen } = useWebviewLayout({
    containerRef: { current: measured },
    isWebviewCreated: true,
    isWebviewAvailable: true,
    isVisible: props.isVisible,
    labelRef: { current: LABEL },
    log: () => {},
  });
  return createElement(
    "div",
    null,
    createElement("button", {
      type: "button",
      "data-action": "update",
      onClick: () => {
        updatePosition({ force: true }).catch(() => {});
      },
    }),
    createElement("button", {
      type: "button",
      "data-action": "park",
      onClick: () => {
        parkOffscreen().catch(() => {});
      },
    })
  );
}

async function render(isVisible: boolean) {
  if (!root || !host) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  }
  const mounted = root;
  await act(async () => {
    mounted.render(createElement(Probe, { isVisible }));
  });
}

async function press(action: "update" | "park") {
  const button = host?.querySelector<HTMLButtonElement>(
    `[data-action="${action}"]`
  );
  await act(async () => {
    button?.click();
  });
}

function positionCalls() {
  return invokeMock.mock.calls
    .filter(([command]) => command === "update_inline_webview_position")
    .map(([, payload]) => payload);
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    }
  );
  invokeMock.mockClear();
});

afterEach(async () => {
  const mounted = root;
  root = null;
  if (mounted) await act(async () => mounted.unmount());
  host?.remove();
  host = null;
  vi.unstubAllGlobals();
});

it("frames a visible view from its container", async () => {
  await render(true);
  await press("update");

  expect(positionCalls()).toEqual([
    { label: LABEL, x: 40, y: 80, a: 840, b: 680, width: 800, height: 600 },
  ]);
});

it("parks off screen at the size the view last had", async () => {
  await render(true);
  await press("update");
  await press("park");

  expect(positionCalls().at(-1)).toEqual({
    label: LABEL,
    x: -10000,
    y: -10000,
    width: 800,
    height: 600,
  });
});

it("leaves a parked view alone when layout changes", async () => {
  await render(true);
  await press("update");
  await render(false);
  await press("park");
  invokeMock.mockClear();

  // What a window resize, a UI-scale change, or the sidebar animation asks of
  // every mounted session, parked or not.
  await press("update");
  await act(async () => {
    window.dispatchEvent(new Event("orgii-ui-scale-applied"));
  });

  expect(positionCalls()).toEqual([]);
});

it("re-sends an unchanged frame when a parked view is shown again", async () => {
  await render(true);
  await press("update");
  await render(false);
  await press("park");
  await render(true);
  invokeMock.mockClear();

  await press("update");

  expect(positionCalls()).toEqual([
    { label: LABEL, x: 40, y: 80, a: 840, b: 680, width: 800, height: 600 },
  ]);
});
