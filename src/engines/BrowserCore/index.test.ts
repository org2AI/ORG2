// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { webviewOverlayBlockedAtom } from "@src/store/ui/overlayAtom";
import { activeOverlayCountAtom } from "@src/store/ui/overlayLayerAtom";
import {
  type BrowserWebviewLoadPhase,
  browserWebviewLoadStateAtom,
} from "@src/store/workstation/browser/webviewLoadStateAtom";
import { getBrowserSessionWebviewLabel } from "@src/util/platform/tauri/browserSessionLabel";

import { WEBVIEW_LOAD_FAILURE_TIMEOUT_MS } from "./hooks/useWebviewLoadFailure";
import BrowserCore from "./index";
import type { BrowserState } from "./types";
import type { BrowserSession } from "./types";

/** Per-test atom reads; anything unlisted reads `false`. */
const atomValues = new Map<unknown, unknown>();

vi.mock("jotai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jotai")>();
  return {
    ...actual,
    useAtomValue: (atom: unknown) => atomValues.get(atom) ?? false,
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@src/components/layout/blocks", () => ({
  Placeholder: ({
    variant,
    placement,
    title,
    subtitle,
    fillParentHeight,
    children,
  }: {
    variant: string;
    placement: string;
    title: string;
    subtitle?: string;
    fillParentHeight?: boolean;
    children?: React.ReactNode;
  }) =>
    createElement(
      "div",
      {
        "data-placeholder-variant": variant,
        "data-placeholder-placement": placement,
        "data-fill-parent-height": String(fillParentHeight),
      },
      title,
      subtitle,
      children
    ),
}));

// Keep this test compatible with the component-ownership relocation. Develop
// still reads Placeholder through the layouts barrel, while PRs that include
// the relocation import the component directly.
vi.mock("@src/components/Placeholder", () => ({
  Placeholder: ({
    variant,
    placement,
    title,
    subtitle,
    fillParentHeight,
    children,
  }: {
    variant: string;
    placement: string;
    title: string;
    subtitle?: string;
    fillParentHeight?: boolean;
    children?: React.ReactNode;
  }) =>
    createElement(
      "div",
      {
        "data-placeholder-variant": variant,
        "data-placeholder-placement": placement,
        "data-fill-parent-height": String(fillParentHeight),
      },
      title,
      subtitle,
      children
    ),
}));

vi.mock("./BrowserSessionWebview", () => ({
  default: () => null,
}));

const SESSION_ID = "browser-session-1";
const LOADED_URL = "http://localhost:1998/";

function createBrowserState(
  sessionOverrides: Partial<BrowserSession> = {}
): BrowserState {
  const session: BrowserSession = {
    id: SESSION_ID,
    url: "",
    title: "New Tab",
    history: [],
    historyIndex: -1,
    isLoading: false,
    error: null,
    ...sessionOverrides,
  };

  return {
    sessions: [session],
    activeSessionId: session.id,
    activeSession: session,
    addSession: vi.fn(),
    closeSession: vi.fn(),
    setActiveSession: vi.fn(),
    updateSession: vi.fn(),
  };
}

/** Records a native load phase for the default session's webview. */
function setLoadPhase(phase: BrowserWebviewLoadPhase | undefined): void {
  if (!phase) {
    atomValues.set(browserWebviewLoadStateAtom, {});
    return;
  }
  atomValues.set(browserWebviewLoadStateAtom, {
    [getBrowserSessionWebviewLabel(SESSION_ID)]: {
      phase,
      url: LOADED_URL,
      at: Date.now(),
    },
  });
}

let roots: Array<() => void> = [];

type BrowserCoreProps = Parameters<typeof BrowserCore>[0];

interface MountedBrowserCore {
  html: () => string;
  advance: (ms: number) => Promise<void>;
  /** Re-render after changing a mocked atom value. */
  rerender: (next?: Partial<BrowserCoreProps>) => Promise<void>;
}

/**
 * Renders BrowserCore into a real root so effects and timers run — both notices
 * are now time-gated and are invisible to `renderToStaticMarkup`.
 */
async function mountBrowserCore(
  props: BrowserCoreProps
): Promise<MountedBrowserCore> {
  const container = document.createElement("div");
  const root = createRoot(container);
  const win = window as unknown as Record<string, unknown>;
  win.__TAURI_INTERNALS__ = {};
  let current = props;

  await act(async () => {
    root.render(createElement(BrowserCore, current));
  });

  roots.push(() => {
    root.unmount();
    delete win.__TAURI_INTERNALS__;
  });

  return {
    html: () => container.innerHTML,
    advance: async (ms: number) => {
      await act(async () => {
        vi.advanceTimersByTime(ms);
      });
    },
    rerender: async (next) => {
      current = { ...current, ...next };
      await act(async () => {
        root.render(createElement(BrowserCore, current));
      });
    },
  };
}

describe("BrowserCore blank tab placeholder", () => {
  it("uses the standard detail-panel placeholder without the TLS note", () => {
    const markup = renderToStaticMarkup(
      createElement(BrowserCore, {
        browserState: createBrowserState(),
      })
    );

    expect(markup).toContain('data-placeholder-variant="empty"');
    expect(markup).toContain('data-placeholder-placement="detail-panel"');
    expect(markup).toContain('data-fill-parent-height="true"');
    expect(markup).toContain("workstation.browserCore.enterUrlToStart");
    expect(markup).not.toContain("workstation.browserCore.tlsDevNote");
  });

  it("keeps private-browsing and replay context in the shared placeholder", () => {
    const markup = renderToStaticMarkup(
      createElement(BrowserCore, {
        browserState: createBrowserState({ incognito: true }),
        showSimulatorNotice: true,
      })
    );

    expect(markup).toContain(
      "workstation.browserCore.privateBrowsingEmptyTitle"
    );
    expect(markup).toContain("workstation.browserCore.simulatorBrowserNotice");
  });

  it("renders a caller-provided complete blank-tab placeholder", () => {
    const markup = renderToStaticMarkup(
      createElement(BrowserCore, {
        browserState: createBrowserState(),
        blankTabPlaceholder: createElement(
          "button",
          { type: "button" },
          "Open port 1998"
        ),
      })
    );

    expect(markup).toContain("Open port 1998");
    expect(markup).not.toContain("workstation.browserCore.enterUrlToStart");
  });

  it("keeps the shared workspace placeholder visible when it does not own webviews", () => {
    const markup = renderToStaticMarkup(
      createElement(BrowserCore, {
        browserState: createBrowserState(),
        blankTabPlaceholder: createElement(
          "button",
          { type: "button" },
          "Open port 1998"
        ),
        manageWebviews: false,
        respectModalBlocking: false,
      })
    );

    expect(markup).toContain("Open port 1998");
  });

  it("does not mount blank-tab options while hidden, navigated, or on the owner host", () => {
    const option = createElement(
      "button",
      { type: "button" },
      "Open port 1998"
    );
    const hiddenMarkup = renderToStaticMarkup(
      createElement(BrowserCore, {
        browserState: createBrowserState(),
        blankTabPlaceholder: option,
        hidden: true,
      })
    );
    const navigatedMarkup = renderToStaticMarkup(
      createElement(BrowserCore, {
        browserState: createBrowserState({ url: LOADED_URL }),
        blankTabPlaceholder: option,
      })
    );
    // SharedBrowserApp: aria-hidden owner host, native anchor only.
    const ownerHostMarkup = renderToStaticMarkup(
      createElement(BrowserCore, {
        browserState: createBrowserState(),
        blankTabPlaceholder: option,
        suppressStatusOverlays: true,
      })
    );

    expect(hiddenMarkup).not.toContain("Open port 1998");
    expect(navigatedMarkup).not.toContain("Open port 1998");
    expect(ownerHostMarkup).not.toContain("Open port 1998");
  });
});

describe("BrowserCore overlay-hidden notice", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.useFakeTimers();
    setLoadPhase("finished");
  });

  afterEach(async () => {
    await act(async () => {
      roots.forEach((dispose) => dispose());
    });
    roots = [];
    vi.useRealTimers();
    vi.unstubAllGlobals();
    atomValues.clear();
  });

  it("explains the blank pane once an overlay keeps the webview parked", async () => {
    atomValues.set(webviewOverlayBlockedAtom, true);

    const view = await mountBrowserCore({
      browserState: createBrowserState({ url: LOADED_URL }),
    });

    expect(view.html()).not.toContain(
      "workstation.browserCore.webviewHiddenTitle"
    );

    await view.advance(500);

    expect(view.html()).toContain("workstation.browserCore.webviewHiddenTitle");
    expect(view.html()).toContain("workstation.browserCore.webviewHiddenBody");
  });

  it("covers the macOS path where the webview is only sent behind React", async () => {
    atomValues.set(activeOverlayCountAtom, 1);

    const view = await mountBrowserCore({
      browserState: createBrowserState({ url: LOADED_URL }),
    });
    await view.advance(500);

    expect(view.html()).toContain("workstation.browserCore.webviewHiddenTitle");
  });

  it("does not flash for a momentary overlay such as a tooltip or hover sidebar", async () => {
    atomValues.set(activeOverlayCountAtom, 1);

    const view = await mountBrowserCore({
      browserState: createBrowserState({ url: LOADED_URL }),
    });
    // Mouse passes over a tooltip target and moves on, well inside the delay.
    await view.advance(200);
    atomValues.set(activeOverlayCountAtom, 0);
    await view.rerender();
    await view.advance(1000);

    expect(view.html()).not.toContain(
      "workstation.browserCore.webviewHiddenTitle"
    );
  });

  it("stays hidden when no overlay is open", async () => {
    const view = await mountBrowserCore({
      browserState: createBrowserState({ url: LOADED_URL }),
    });
    await view.advance(500);

    expect(view.html()).not.toContain(
      "workstation.browserCore.webviewHiddenTitle"
    );
  });

  it("shows on the shared-runtime chrome that does not own the webview", async () => {
    atomValues.set(activeOverlayCountAtom, 1);

    const view = await mountBrowserCore({
      browserState: createBrowserState({ url: LOADED_URL }),
      // SharedBrowserWorkspace -> WebViewport shape: visible chrome, but
      // SharedBrowserApp owns the native webview.
      respectModalBlocking: false,
      manageWebviews: false,
    });
    await view.advance(500);

    expect(view.html()).toContain("workstation.browserCore.webviewHiddenTitle");
  });

  it("stays hidden on blank tabs, host-hidden panes, and the owner host", async () => {
    atomValues.set(webviewOverlayBlockedAtom, true);
    atomValues.set(activeOverlayCountAtom, 1);

    const blankUrl = await mountBrowserCore({
      browserState: createBrowserState(),
    });
    const hostHidden = await mountBrowserCore({
      browserState: createBrowserState({ url: LOADED_URL }),
      hidden: true,
    });
    // SharedBrowserApp: aria-hidden owner host stacked over the same rect.
    const ownerHost = await mountBrowserCore({
      browserState: createBrowserState({ url: LOADED_URL }),
      respectModalBlocking: false,
      bypassStationModeBlocking: true,
      suppressStatusOverlays: true,
    });
    await blankUrl.advance(500);

    expect(blankUrl.html()).not.toContain(
      "workstation.browserCore.webviewHiddenTitle"
    );
    expect(hostHidden.html()).not.toContain(
      "workstation.browserCore.webviewHiddenTitle"
    );
    expect(ownerHost.html()).not.toContain(
      "workstation.browserCore.webviewHiddenTitle"
    );
  });
});

describe("BrowserCore load-failure notice", () => {
  const GRACE = WEBVIEW_LOAD_FAILURE_TIMEOUT_MS + 1000;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.useFakeTimers();
  });

  afterEach(async () => {
    await act(async () => {
      roots.forEach((dispose) => dispose());
    });
    roots = [];
    vi.useRealTimers();
    vi.unstubAllGlobals();
    atomValues.clear();
  });

  it("stays silent on a page the native webview finished loading", async () => {
    // The regression the hostname allowlist caused: github.com rendered fine and
    // still got told it might not work in an embedded browser.
    setLoadPhase("finished");

    const view = await mountBrowserCore({
      browserState: createBrowserState({
        url: "https://github.com/org2AI/ORG2/pull/1764",
      }),
    });
    await view.advance(GRACE);

    expect(view.html()).not.toContain(
      "workstation.browserCore.loadStalledTitle"
    );
  });

  it("reports a navigation that started and never finished", async () => {
    setLoadPhase("started");

    const view = await mountBrowserCore({
      browserState: createBrowserState({ url: LOADED_URL }),
    });

    expect(view.html()).not.toContain(
      "workstation.browserCore.loadStalledTitle"
    );

    await view.advance(GRACE);

    expect(view.html()).toContain("workstation.browserCore.loadStalledTitle");
    // Title plus two actions: the URL already sits in the URL bar above.
    expect(view.html()).toContain("actions.reload");
    expect(view.html()).toContain("workstation.browserCore.copyUrl");
    expect(view.html()).not.toContain(LOADED_URL);
    expect(view.html()).not.toContain("previews.openInBrowser");
    expect(view.html()).not.toContain("actions.dismiss");
  });

  it("reports a webview that never reported any phase at all", async () => {
    setLoadPhase(undefined);

    const view = await mountBrowserCore({
      browserState: createBrowserState({ url: LOADED_URL }),
    });
    await view.advance(GRACE);

    expect(view.html()).toContain("workstation.browserCore.loadStalledTitle");
  });

  it("yields to the overlay-hidden notice instead of stacking over it", async () => {
    setLoadPhase("started");
    atomValues.set(activeOverlayCountAtom, 1);

    const view = await mountBrowserCore({
      browserState: createBrowserState({ url: LOADED_URL }),
      respectModalBlocking: false,
      manageWebviews: false,
    });
    await view.advance(GRACE);

    expect(view.html()).toContain("workstation.browserCore.webviewHiddenTitle");
    expect(view.html()).not.toContain(
      "workstation.browserCore.loadStalledTitle"
    );
  });

  it("does not accrue failure time while an overlay parks the webview", async () => {
    setLoadPhase("started");
    atomValues.set(webviewOverlayBlockedAtom, true);

    const view = await mountBrowserCore({
      browserState: createBrowserState({
        url: LOADED_URL,
        // respectModalBlocking defaults on, so the pane is inactive too.
      }),
    });
    await view.advance(GRACE);

    expect(view.html()).not.toContain(
      "workstation.browserCore.loadStalledTitle"
    );
  });

  it("defers to the hard error card rather than doubling it", async () => {
    setLoadPhase("started");

    const view = await mountBrowserCore({
      browserState: createBrowserState({
        url: LOADED_URL,
        error: "ERR_CONNECTION_REFUSED",
      }),
    });
    await view.advance(GRACE);

    expect(view.html()).toContain(
      "workstation.browserCore.siteUnreachableTitle"
    );
    expect(view.html()).not.toContain(
      "workstation.browserCore.loadStalledTitle"
    );
  });

  it("renders nothing on the aria-hidden owner host", async () => {
    setLoadPhase("started");

    const view = await mountBrowserCore({
      browserState: createBrowserState({ url: LOADED_URL }),
      respectModalBlocking: false,
      bypassStationModeBlocking: true,
      suppressStatusOverlays: true,
    });
    await view.advance(GRACE);

    expect(view.html()).not.toContain(
      "workstation.browserCore.loadStalledTitle"
    );
  });
});
