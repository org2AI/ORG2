// @vitest-environment jsdom
import { act, createElement, createRef } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  type OAuthSessionSetupCaptureState,
  type OAuthSessionSetupCopy,
  OAuthSessionSetupShell,
  type OAuthSessionSetupShellProps,
} from "./OAuthSessionSetupShell";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

const copy: OAuthSessionSetupCopy = {
  signInTitle: "Sign in",
  signInDescription: "Connect your account",
  signInButton: "Continue",
  signedInTitle: "Connected",
  signedInStatus: "Signed in",
  loginStep: "Login",
  browserHint: "Complete login in the browser",
  readyTitle: "Ready to sign in",
  oauthHint: "The browser will open here",
  loading: "Loading",
  failedToLoadBrowser: "Browser failed",
  retry: "Retry",
  close: "Close",
  errorHint: "Try signing in again",
};

function makeCapture(
  overrides: Partial<OAuthSessionSetupCaptureState> = {}
): OAuthSessionSetupCaptureState {
  return {
    isSigningIn: false,
    isSignedIn: false,
    isWebviewOpen: false,
    isWebviewLoading: false,
    currentUrl: "",
    authUrl: null,
    error: null,
    startLogin: vi.fn(() => Promise.resolve()),
    closeWebview: vi.fn(() => Promise.resolve()),
    reset: vi.fn(),
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

function renderShell(
  props: Partial<OAuthSessionSetupShellProps> & {
    capture: OAuthSessionSetupCaptureState;
  }
): void {
  act(() => {
    root.render(
      createElement(OAuthSessionSetupShell, {
        providerId: "provider",
        containerRef: createRef<HTMLDivElement>(),
        hasToken: false,
        copy,
        ...props,
      })
    );
  });
}

const query = <T extends Element = HTMLElement>(selector: string) =>
  container.querySelector<T>(selector);

const signInButton = () =>
  query<HTMLButtonElement>('[data-testid="provider-oauth-signin"]');
const browserShell = () =>
  query('[data-testid="provider-oauth-browser-shell"]');
const closeButton = () =>
  query<HTMLButtonElement>('[data-testid="provider-oauth-browser-close"]');

async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeAll(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.clearAllMocks();
});

afterAll(() => {
  Reflect.deleteProperty(reactActEnvironment, "IS_REACT_ACT_ENVIRONMENT");
});

describe("OAuthSessionSetupShell browser lifecycle", () => {
  it("opens the browser on sign-in and starts exactly one login per open", async () => {
    const capture = makeCapture();
    const onBrowserStateChange = vi.fn();
    renderShell({ capture, onBrowserStateChange });

    expect(signInButton()?.textContent).toBe("Continue");
    expect(browserShell()).toBeNull();
    expect(onBrowserStateChange).toHaveBeenLastCalledWith(false);

    act(() => signInButton()?.click());

    expect(browserShell()).not.toBeNull();
    expect(signInButton()).toBeNull();
    expect(onBrowserStateChange).toHaveBeenLastCalledWith(true);
    expect(capture.startLogin).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(capture.startLogin).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);

    // The native webview can close on its own while the React surface stays
    // open (macOS popup handling). That must not schedule a second attempt,
    // even when the capture hook hands us a new startLogin identity.
    const replacementStart = vi.fn(() => Promise.resolve());
    renderShell({
      capture: makeCapture({ startLogin: replacementStart }),
      onBrowserStateChange,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(capture.startLogin).toHaveBeenCalledTimes(1);
    expect(replacementStart).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(browserShell()).not.toBeNull();
  });

  it("clears the pending auto-start timer on unmount", async () => {
    const capture = makeCapture();
    renderShell({ capture });

    act(() => signInButton()?.click());
    expect(vi.getTimerCount()).toBe(1);

    act(() => root.unmount());
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(500);
    expect(capture.startLogin).not.toHaveBeenCalled();

    // afterEach unmounts again; give it a fresh root so that stays a no-op.
    root = createRoot(container);
  });

  it("mounts with the browser open when initiallyOpen is set", async () => {
    const capture = makeCapture();
    const onBrowserStateChange = vi.fn();
    renderShell({ capture, initiallyOpen: true, onBrowserStateChange });

    expect(browserShell()).not.toBeNull();
    expect(onBrowserStateChange).toHaveBeenLastCalledWith(true);
    expect(
      query('[data-testid="provider-oauth-current-url"]')?.textContent
    ).toBe("Ready to sign in");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(capture.startLogin).toHaveBeenCalledTimes(1);
  });

  it("collapses back to the idle view once sign-in completes and the webview closes", async () => {
    const onBrowserStateChange = vi.fn();
    renderShell({
      capture: makeCapture({ isWebviewOpen: true }),
      initiallyOpen: true,
      onBrowserStateChange,
    });
    expect(browserShell()).not.toBeNull();

    renderShell({
      capture: makeCapture({ isWebviewOpen: false, isSignedIn: true }),
      initiallyOpen: true,
      hasToken: true,
      onBrowserStateChange,
    });
    await flushMicrotasks();

    expect(browserShell()).toBeNull();
    expect(signInButton()?.textContent).toBe("✓ Signed in");
    expect(container.textContent).toContain("Connected");
    expect(onBrowserStateChange).toHaveBeenLastCalledWith(false);
  });

  it("closes the native webview and returns to idle from the X button", () => {
    const capture = makeCapture({ isWebviewOpen: true });
    const onBrowserStateChange = vi.fn();
    renderShell({ capture, initiallyOpen: true, onBrowserStateChange });

    act(() => closeButton()?.click());

    expect(capture.closeWebview).toHaveBeenCalledTimes(1);
    expect(browserShell()).toBeNull();
    expect(signInButton()).not.toBeNull();
    expect(onBrowserStateChange).toHaveBeenLastCalledWith(false);
  });

  it("honors an external close signal only while the browser is visible", async () => {
    const capture = makeCapture();
    renderShell({ capture, closeSignal: 1 });
    await flushMicrotasks();
    expect(capture.closeWebview).not.toHaveBeenCalled();
    expect(signInButton()).not.toBeNull();

    renderShell({ capture, closeSignal: 0 });
    act(() => signInButton()?.click());
    expect(browserShell()).not.toBeNull();

    renderShell({
      capture: makeCapture({
        isWebviewOpen: true,
        closeWebview: capture.closeWebview,
      }),
      closeSignal: 1,
    });
    await flushMicrotasks();

    expect(capture.closeWebview).toHaveBeenCalledTimes(1);
    expect(browserShell()).toBeNull();
    expect(signInButton()).not.toBeNull();
  });

  it("retry resets the capture and starts a new login immediately", async () => {
    const capture = makeCapture({ error: "network unavailable" });
    renderShell({ capture, initiallyOpen: true });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(capture.startLogin).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Browser failed");
    expect(container.textContent).toContain("network unavailable");

    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Retry"
    );
    expect(retry).toBeDefined();
    act(() => retry?.click());

    expect(capture.reset).toHaveBeenCalledTimes(1);
    expect(capture.startLogin).toHaveBeenCalledTimes(2);
    expect(browserShell()).not.toBeNull();
  });
});

describe("OAuthSessionSetupShell idle notices", () => {
  it("dismisses a capture error through reset", () => {
    const capture = makeCapture({ error: "state mismatch" });
    const onClearTokenError = vi.fn();
    renderShell({ capture, onClearTokenError });

    expect(container.textContent).toContain("state mismatch");
    expect(container.textContent).toContain("Try signing in again");

    const dismiss =
      query<HTMLButtonElement>('[data-icon="x"]')?.closest("button");
    expect(dismiss).not.toBeNull();
    act(() => dismiss?.click());

    expect(capture.reset).toHaveBeenCalledTimes(1);
    expect(onClearTokenError).not.toHaveBeenCalled();
  });

  it("dismisses a token error through onClearTokenError", () => {
    const capture = makeCapture();
    const onClearTokenError = vi.fn();
    renderShell({ capture, tokenError: "token rejected", onClearTokenError });

    expect(container.textContent).toContain("token rejected");

    const dismiss =
      query<HTMLButtonElement>('[data-icon="x"]')?.closest("button");
    act(() => dismiss?.click());

    expect(onClearTokenError).toHaveBeenCalledTimes(1);
    expect(capture.reset).not.toHaveBeenCalled();
  });

  it("renders provider debug content inside the shared debug container", () => {
    renderShell({
      capture: makeCapture(),
      debugContent: createElement("div", null, "Id Token: null"),
    });

    expect(container.textContent).toContain("Id Token: null");
  });
});

describe("OAuthSessionSetupShell retry coalescing and close idempotency", () => {
  it("ignores a second retry while the first startLogin is still in flight", async () => {
    let resolveStart: () => void = () => {};
    const startLogin = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveStart = resolve;
        })
    );
    const capture = makeCapture({ error: "network unavailable", startLogin });
    renderShell({ capture, initiallyOpen: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(startLogin).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveStart();
    });

    const retry = query<HTMLButtonElement>('button[aria-label="Retry"]');
    expect(retry).not.toBeNull();
    act(() => {
      retry?.click();
      retry?.click();
    });
    expect(capture.reset).toHaveBeenCalledTimes(1);
    expect(startLogin).toHaveBeenCalledTimes(2);

    // Still in flight: a later click is coalesced too.
    act(() => query<HTMLButtonElement>('button[aria-label="Retry"]')?.click());
    expect(startLogin).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveStart();
      await Promise.resolve();
    });
    act(() => query<HTMLButtonElement>('button[aria-label="Retry"]')?.click());
    expect(startLogin).toHaveBeenCalledTimes(3);
    expect(capture.reset).toHaveBeenCalledTimes(2);
  });

  it("releases the retry guard when startLogin rejects", async () => {
    const startLogin = vi.fn(() => Promise.resolve());
    startLogin
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("boom"));
    const capture = makeCapture({ startLogin });
    renderShell({ capture, initiallyOpen: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(startLogin).toHaveBeenCalledTimes(1);

    const retry = () => query<HTMLButtonElement>('button[aria-label="Retry"]');
    await act(async () => {
      retry()?.click();
      await Promise.resolve();
    });
    expect(startLogin).toHaveBeenCalledTimes(2);

    await flushMicrotasks();
    act(() => retry()?.click());
    expect(startLogin).toHaveBeenCalledTimes(3);
  });

  it("issues one native close for a double X click", () => {
    const capture = makeCapture({ isWebviewOpen: true });
    const onBrowserStateChange = vi.fn();
    renderShell({ capture, initiallyOpen: true, onBrowserStateChange });

    const close = closeButton();
    expect(close).not.toBeNull();
    act(() => {
      close?.click();
      close?.click();
    });

    expect(capture.closeWebview).toHaveBeenCalledTimes(1);
    expect(browserShell()).toBeNull();
    expect(onBrowserStateChange).toHaveBeenLastCalledWith(false);
  });

  it("does not close natively again when a closeSignal follows an X close", async () => {
    const capture = makeCapture({ isWebviewOpen: true });
    renderShell({ capture, initiallyOpen: true, closeSignal: 0 });

    act(() => closeButton()?.click());
    expect(capture.closeWebview).toHaveBeenCalledTimes(1);

    renderShell({ capture, initiallyOpen: true, closeSignal: 1 });
    await flushMicrotasks();
    expect(capture.closeWebview).toHaveBeenCalledTimes(1);
    expect(browserShell()).toBeNull();
  });

  it("closes once when a closeSignal and an X click land in the same turn", async () => {
    const capture = makeCapture({ isWebviewOpen: true });
    renderShell({ capture, initiallyOpen: true, closeSignal: 0 });

    const close = closeButton();
    act(() => {
      root.render(
        createElement(OAuthSessionSetupShell, {
          providerId: "provider",
          containerRef: createRef<HTMLDivElement>(),
          hasToken: false,
          copy,
          capture,
          initiallyOpen: true,
          closeSignal: 1,
        })
      );
      close?.click();
    });
    await flushMicrotasks();

    expect(capture.closeWebview).toHaveBeenCalledTimes(1);
    expect(browserShell()).toBeNull();
  });

  it("clears timers on unmount after a retry reopened the browser", async () => {
    const capture = makeCapture({ isWebviewOpen: true });
    renderShell({ capture, initiallyOpen: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(capture.startLogin).toHaveBeenCalledTimes(1);

    act(() => closeButton()?.click());
    expect(browserShell()).toBeNull();
    act(() => signInButton()?.click());
    expect(vi.getTimerCount()).toBe(1);

    act(() => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(500);
    expect(capture.startLogin).toHaveBeenCalledTimes(1);

    root = createRoot(container);
  });
});

describe("OAuthSessionSetupShell accessibility semantics", () => {
  it("labels the icon-only refresh and close controls", () => {
    renderShell({ capture: makeCapture(), initiallyOpen: true });

    const retry = query<HTMLButtonElement>('button[aria-label="Retry"]');
    const close = closeButton();
    expect(retry?.getAttribute("title")).toBe("Retry");
    expect(close?.getAttribute("aria-label")).toBe("Close");
    expect(close?.getAttribute("title")).toBe("Close");
  });

  it("exposes the loading overlay as a status region", () => {
    renderShell({
      capture: makeCapture({ isSigningIn: true }),
      initiallyOpen: true,
    });

    const status = query('[role="status"]');
    expect(status?.textContent).toContain("Loading");
    expect(query('[role="alert"]')).toBeNull();
  });

  it("exposes the error overlay as an alert", () => {
    renderShell({
      capture: makeCapture({ error: "network unavailable" }),
      initiallyOpen: true,
    });

    const alert = query('[role="alert"]');
    expect(alert?.textContent).toContain("Browser failed");
    expect(alert?.textContent).toContain("network unavailable");
    expect(query('[role="status"]')).toBeNull();
  });

  it("marks the active step with aria-current", () => {
    renderShell({ capture: makeCapture(), initiallyOpen: true });
    let current = container.querySelectorAll('[aria-current="step"]');
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toBe("1");

    renderShell({
      capture: makeCapture(),
      initiallyOpen: true,
      hasToken: true,
    });
    current = container.querySelectorAll('[aria-current="step"]');
    expect(current).toHaveLength(1);
    expect(current[0].parentElement?.textContent).toContain("Signed in");
  });
});
