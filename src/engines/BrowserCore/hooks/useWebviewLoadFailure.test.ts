// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  WEBVIEW_LOAD_FAILURE_TIMEOUT_MS,
  useWebviewLoadFailure,
} from "./useWebviewLoadFailure";

type Options = Parameters<typeof useWebviewLoadFailure>[0];

const STARTED = {
  phase: "started",
  url: "https://example.com/",
  at: 0,
} as const;

function finishedAt(at: number) {
  return { phase: "finished", url: "https://example.com/", at } as const;
}

const BASE: Options = {
  sessionId: "session-1",
  url: "https://example.com/",
  loadState: STARTED,
  isWatching: true,
};

let dispose: (() => void) | null = null;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
});

afterEach(async () => {
  if (dispose) {
    const unmount = dispose;
    await act(async () => unmount());
    dispose = null;
  }
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

interface Harness {
  failed: () => boolean;
  update: (next: Partial<Options>) => Promise<void>;
  advance: (ms: number) => Promise<void>;
  dismiss: () => Promise<void>;
  reset: () => Promise<void>;
}

async function mount(initial: Partial<Options> = {}): Promise<Harness> {
  let options: Options = { ...BASE, ...initial };

  // Rendered rather than captured: reassigning an outer binding during render
  // is a side effect the hook rules reject, and the DOM is the honest readout.
  function Probe(props: { options: Options }) {
    const { hasFailed, dismiss, reset } = useWebviewLoadFailure(props.options);
    return createElement(
      "div",
      null,
      createElement("output", null, String(hasFailed)),
      createElement("button", {
        type: "button",
        "data-action": "dismiss",
        onClick: dismiss,
      }),
      createElement("button", {
        type: "button",
        "data-action": "reset",
        onClick: reset,
      })
    );
  }

  const container = document.createElement("div");
  const root = createRoot(container);
  const render = async () => {
    await act(async () => {
      root.render(createElement(Probe, { options }));
    });
  };
  const click = async (action: string) => {
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(`[data-action="${action}"]`)
        ?.click();
    });
  };

  await render();
  dispose = () => root.unmount();

  return {
    failed: () => container.querySelector("output")?.textContent === "true",
    update: async (next) => {
      options = { ...options, ...next };
      await render();
    },
    advance: async (ms) => {
      await act(async () => {
        vi.advanceTimersByTime(ms);
      });
    },
    dismiss: () => click("dismiss"),
    reset: () => click("reset"),
  };
}

const GRACE = WEBVIEW_LOAD_FAILURE_TIMEOUT_MS + 1;

it("reports a start that never finishes, and only after the grace period", async () => {
  const harness = await mount();

  expect(harness.failed()).toBe(false);
  await harness.advance(WEBVIEW_LOAD_FAILURE_TIMEOUT_MS - 1);
  expect(harness.failed()).toBe(false);

  await harness.advance(2);
  expect(harness.failed()).toBe(true);
});

it("never reports a finished load", async () => {
  const harness = await mount({ loadState: finishedAt(0) });

  await harness.advance(GRACE);
  expect(harness.failed()).toBe(false);
});

it("clears itself when a slow page finishes after the grace period", async () => {
  const harness = await mount();

  await harness.advance(GRACE);
  expect(harness.failed()).toBe(true);

  await harness.update({ loadState: finishedAt(Date.now()) });
  expect(harness.failed()).toBe(false);
});

it("does not accrue failure time while the pane is unwatchable", async () => {
  const harness = await mount({ isWatching: false });

  await harness.advance(GRACE * 3);
  expect(harness.failed()).toBe(false);

  // The clock only starts once the pane is visible and unobstructed.
  await harness.update({ isWatching: true });
  expect(harness.failed()).toBe(false);
  await harness.advance(GRACE);
  expect(harness.failed()).toBe(true);
});

it("keeps a dismissal across overlay churn, unlike the old re-arming timer", async () => {
  const harness = await mount();

  await harness.advance(GRACE);
  await harness.dismiss();
  expect(harness.failed()).toBe(false);

  // A dropdown opening and closing used to restart the countdown and bring the
  // dismissed card back.
  await harness.update({ isWatching: false });
  await harness.update({ isWatching: true });
  await harness.advance(GRACE);
  expect(harness.failed()).toBe(false);
});

it("re-arms for a different URL in the same session", async () => {
  const harness = await mount();

  await harness.advance(GRACE);
  await harness.dismiss();
  expect(harness.failed()).toBe(false);

  await harness.update({ url: "https://example.com/other" });
  expect(harness.failed()).toBe(false);
  await harness.advance(GRACE);
  expect(harness.failed()).toBe(true);
});

it("reset clears both the failure and its dismissal", async () => {
  const harness = await mount();

  await harness.advance(GRACE);
  expect(harness.failed()).toBe(true);

  await harness.reset();
  expect(harness.failed()).toBe(false);

  // Reload did not help: the notice comes back on its own.
  await harness.advance(GRACE);
  expect(harness.failed()).toBe(true);
});

it("ignores a finish recorded before the tab navigated in place", async () => {
  // WKWebView reports `started` from didCommitNavigation, so a DNS or TLS
  // failure emits nothing and leaves the previous page's finish standing.
  const harness = await mount({ loadState: finishedAt(Date.now()) });

  await harness.advance(GRACE);
  expect(harness.failed()).toBe(false);

  await harness.update({ url: "https://broken.example/" });
  await harness.advance(GRACE);
  expect(harness.failed()).toBe(true);
});

it("trusts the finish already recorded for a tab switched back into", async () => {
  // Switching tabs is not a navigation: the other session's webview finished
  // loading long ago and will not report a new phase.
  const staleFinish = finishedAt(Date.now());
  const harness = await mount({ loadState: staleFinish });

  await harness.advance(GRACE * 2);
  await harness.update({
    sessionId: "session-2",
    url: "https://other.example/",
    loadState: staleFinish,
  });
  await harness.advance(GRACE);

  expect(harness.failed()).toBe(false);
});

it("stays quiet on a blank tab with no URL", async () => {
  const harness = await mount({ url: undefined });

  await harness.advance(GRACE);
  expect(harness.failed()).toBe(false);
});
